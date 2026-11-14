// Counts the frames a monitor actually shows, using DXGI Desktop Duplication (no administrator rights needed).
// Each second it prints how many desktop updates the monitor got and how many of them changed the picture in the
// measured region. With Lossless Scaling frame generation on, "changed" should be close to its output rate; without
// it, close to the game's frame rate. Build and run with tools/screen-fps/run.ps1.
//
// The COM interfaces are called through their vtable slots because .NET Framework's csc has no DirectX headers.
// IDXGIOutput1 (00cddea8-...) was confirmed on real hardware: the output object answers IDXGIOutput..IDXGIOutput6
// with one pointer, so DuplicateOutput is slot 22.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

static class ScreenFps {
  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);
  [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags,
    IntPtr featureLevels, uint levels, uint sdkVersion, out IntPtr device, out int featureLevel, out IntPtr context);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QueryInterfaceFn(IntPtr self, ref Guid iid, out IntPtr result);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint ReleaseFn(IntPtr self);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int EnumFn(IntPtr self, uint index, out IntPtr result);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int OutputDescFn(IntPtr self, out OutputDesc desc);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DuplicateOutputFn(IntPtr self, IntPtr device, out IntPtr duplication);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int AcquireFn(IntPtr self, uint timeoutMs, out FrameInfo info, out IntPtr resource);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int ReleaseFrameFn(IntPtr self);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateTextureFn(IntPtr self, ref TextureDesc desc, IntPtr init, out IntPtr texture);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void CopyRegionFn(IntPtr self, IntPtr dst, uint dstSub, uint x, uint y, uint z, IntPtr src, uint srcSub, ref Box box);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int MapFn(IntPtr self, IntPtr resource, uint sub, int mapType, uint flags, out Mapped mapped);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void UnmapFn(IntPtr self, IntPtr resource, uint sub);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct OutputDesc {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    public int Left, Top, Right, Bottom; public int Attached; public int Rotation; public IntPtr Monitor;
  }
  [StructLayout(LayoutKind.Sequential)] struct FrameInfo {
    public long LastPresentTime, LastMouseUpdateTime; public uint AccumulatedFrames; public int RectsCoalesced, ProtectedMasked;
    public int PointerX, PointerY, PointerVisible; public uint MetadataSize, PointerShapeSize;
  }
  [StructLayout(LayoutKind.Sequential)] struct TextureDesc {
    public uint Width, Height, MipLevels, ArraySize; public int Format; public uint SampleCount, SampleQuality;
    public int Usage; public uint BindFlags, CpuAccess, MiscFlags;
  }
  [StructLayout(LayoutKind.Sequential)] struct Box { public uint Left, Top, Front, Right, Bottom, Back; }
  [StructLayout(LayoutKind.Sequential)] struct Mapped { public IntPtr Data; public uint RowPitch, DepthPitch; }

  const int WaitTimeout = unchecked((int)0x887A0027), AccessLost = unchecked((int)0x887A0026);
  /** A sampled pixel counts as changed above this channel difference, so dithering and cursor-free noise do not. */
  const int Threshold = 3;

  static T Slot<T>(IntPtr obj, int index) where T : class {
    return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj), index * IntPtr.Size), typeof(T)) as T;
  }
  static void Release(IntPtr obj) { if (obj != IntPtr.Zero) Slot<ReleaseFn>(obj, 2)(obj); }
  static void Check(int hr, string what) { if (hr < 0) throw new Exception(string.Format("{0} failed: 0x{1:X8}", what, hr)); }

  static int Main(string[] args) {
    string display = null; int seconds = 0; double fraction = 0.5;
    for (int i = 0; i < args.Length; i++) {
      if (args[i] == "--display" && i + 1 < args.Length) display = args[++i];
      else if (args[i] == "--seconds" && i + 1 < args.Length) seconds = int.Parse(args[++i]);
      else if (args[i] == "--region" && i + 1 < args.Length) fraction = double.Parse(args[++i], System.Globalization.CultureInfo.InvariantCulture);
      else { Console.Error.WriteLine("usage: screen-fps [--display \\\\.\\DISPLAY1] [--seconds N] [--region 0.5]"); return 2; }
    }
    try { return Run(display, seconds, Math.Min(1, Math.Max(0.05, fraction))); }
    catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
  }

  static int Run(string display, int seconds, double fraction) {
    var iidFactory1 = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
    var iidOutput1 = new Guid("00cddea8-939b-4b83-a340-a685226666cc");
    var iidTexture2D = new Guid("6f15aaf2-d208-4e89-9ab4-489535d34f9c");
    IntPtr factory; Check(CreateDXGIFactory1(ref iidFactory1, out factory), "CreateDXGIFactory1");

    IntPtr adapter = IntPtr.Zero, output = IntPtr.Zero; OutputDesc desc = new OutputDesc();
    for (uint a = 0; output == IntPtr.Zero && Slot<EnumFn>(factory, 12)(factory, a, out adapter) >= 0; a++) {
      IntPtr o;
      for (uint n = 0; Slot<EnumFn>(adapter, 7)(adapter, n, out o) >= 0; n++) {
        OutputDesc d; Slot<OutputDescFn>(o, 7)(o, out d);
        bool primary = d.Left == 0 && d.Top == 0;
        if (d.Attached != 0 && (display == null ? primary : string.Equals(d.DeviceName, display, StringComparison.OrdinalIgnoreCase))) { output = o; desc = d; break; }
        Release(o);
      }
      if (output == IntPtr.Zero) Release(adapter);
    }
    if (output == IntPtr.Zero) throw new Exception("Display not found: " + (display ?? "primary"));

    IntPtr output1; Check(Slot<QueryInterfaceFn>(output, 0)(output, ref iidOutput1, out output1), "IDXGIOutput1");
    IntPtr device, context; int level;
    Check(D3D11CreateDevice(adapter, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, 7, out device, out level, out context), "D3D11CreateDevice");

    int width = desc.Right - desc.Left, height = desc.Bottom - desc.Top;
    var box = new Box {
      Left = (uint)(width * (1 - fraction) / 2), Top = (uint)(height * (1 - fraction) / 2), Front = 0,
      Right = (uint)(width * (1 + fraction) / 2), Bottom = (uint)(height * (1 + fraction) / 2), Back = 1,
    };
    uint rw = box.Right - box.Left, rh = box.Bottom - box.Top;
    var td = new TextureDesc { Width = rw, Height = rh, MipLevels = 1, ArraySize = 1, Format = 87 /* B8G8R8A8_UNORM */,
      SampleCount = 1, Usage = 3 /* STAGING */, CpuAccess = 0x20000 /* READ */ };
    IntPtr staging; Check(Slot<CreateTextureFn>(device, 5)(device, ref td, IntPtr.Zero, out staging), "CreateTexture2D");

    Console.WriteLine("{0} {1}x{2}, measuring the centre {3}x{4}. Ctrl+C stops.", desc.DeviceName, width, height, rw, rh);
    Console.WriteLine("updates/s = desktop presents the monitor got; changed/s = updates that changed the picture; missed = presents merged into one update");

    // Every 4th pixel of every 4th row: enough to see any moving object, cheap at 240 Hz.
    const int Step = 4;
    var prev = new byte[(rw / Step + 1) * (rh / Step + 1) * 3];
    var cur = new byte[prev.Length];
    bool havePrev = false;
    IntPtr dup = IntPtr.Zero;
    var clock = Stopwatch.StartNew(); long windowStart = 0;
    int updates = 0, changed = 0, missed = 0, printed = 0;
    while (seconds == 0 || printed < seconds) {
      if (dup == IntPtr.Zero) { Check(Slot<DuplicateOutputFn>(output1, 22)(output1, device, out dup), "DuplicateOutput"); havePrev = false; }
      FrameInfo info; IntPtr resource;
      int hr = Slot<AcquireFn>(dup, 8)(dup, 100, out info, out resource);
      if (hr == AccessLost) { Release(dup); dup = IntPtr.Zero; Thread.Sleep(200); continue; }
      if (hr != WaitTimeout) {
        Check(hr, "AcquireNextFrame");
        if (info.LastPresentTime != 0) {
          updates++;
          if (info.AccumulatedFrames > 1) missed += (int)info.AccumulatedFrames - 1;
          IntPtr texture; Check(Slot<QueryInterfaceFn>(resource, 0)(resource, ref iidTexture2D, out texture), "ID3D11Texture2D");
          Slot<CopyRegionFn>(context, 46)(context, staging, 0, 0, 0, 0, texture, 0, ref box);
          Release(texture);
          Mapped m; Check(Slot<MapFn>(context, 14)(context, staging, 0, 1 /* READ */, 0, out m), "Map");
          bool diff = Sample(m, rw, rh, Step, cur, prev, havePrev);
          Slot<UnmapFn>(context, 15)(context, staging, 0);
          if (diff || !havePrev) changed++;
          var t = prev; prev = cur; cur = t; havePrev = true;
        }
        Release(resource);
        Slot<ReleaseFrameFn>(dup, 14)(dup);
      }
      long now = clock.ElapsedMilliseconds;
      if (now - windowStart >= 1000) {
        double sec = (now - windowStart) / 1000.0;
        Console.WriteLine("updates {0,4:0}/s   changed {1,4:0}/s   missed {2}", updates / sec, changed / sec, missed);
        updates = changed = missed = 0; windowStart = now; printed++;
      }
    }
    Release(dup); Release(staging); Release(context); Release(device); Release(output1); Release(output); Release(adapter); Release(factory);
    return 0;
  }

  /** Copies the sampled pixels into cur and reports whether any differs from prev by more than Threshold. */
  static bool Sample(Mapped m, uint rw, uint rh, int step, byte[] cur, byte[] prev, bool havePrev) {
    bool diff = false; int k = 0;
    var row = new byte[rw * 4];
    for (uint y = 0; y < rh; y += (uint)step) {
      Marshal.Copy(IntPtr.Add(m.Data, (int)(y * m.RowPitch)), row, 0, row.Length);
      for (uint x = 0; x < rw; x += (uint)step) {
        int p = (int)x * 4;
        for (int c = 0; c < 3; c++, k++) {
          cur[k] = row[p + c];
          if (havePrev && !diff && Math.Abs(cur[k] - prev[k]) > Threshold) diff = true;
        }
      }
    }
    return diff;
  }
}

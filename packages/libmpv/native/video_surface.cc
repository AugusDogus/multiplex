#include "video_surface.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#if defined(_WIN32)

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <GL/gl.h>

namespace {

constexpr wchar_t kWindowClassName[] = L"MultiplexLibmpvSurface";

LRESULT CALLBACK SurfaceWindowProc(HWND window, UINT message, WPARAM wparam,
                                   LPARAM lparam) {
  return DefWindowProcW(window, message, wparam, lparam);
}

bool RegisterSurfaceClass(std::string* error) {
  static const bool registered = [] {
    WNDCLASSW window_class{};
    window_class.style = CS_OWNDC;
    window_class.lpfnWndProc = SurfaceWindowProc;
    window_class.hInstance = GetModuleHandleW(nullptr);
    window_class.lpszClassName = kWindowClassName;
    return RegisterClassW(&window_class) != 0 ||
           GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  }();
  if (!registered) *error = "Windows could not register the libmpv surface class.";
  return registered;
}

template <typename T>
T ReadHandle(const std::vector<std::uint8_t>& bytes) {
  std::uintptr_t value = 0;
  std::memcpy(&value, bytes.data(), std::min(bytes.size(), sizeof(value)));
  return reinterpret_cast<T>(value);
}

class Win32VideoSurface final : public VideoSurface {
 public:
  Win32VideoSurface(HWND owner, HWND window, HDC device_context,
                    HGLRC open_gl_context)
      : owner_(owner),
        window_(window),
        device_context_(device_context),
        open_gl_context_(open_gl_context) {}

  ~Win32VideoSurface() override {
    wglMakeCurrent(nullptr, nullptr);
    if (open_gl_context_) wglDeleteContext(open_gl_context_);
    if (device_context_) ReleaseDC(window_, device_context_);
    if (window_) DestroyWindow(window_);
  }

  bool Show(const SurfaceBounds& bounds, std::string* error) override {
    POINT owner_origin{0, 0};
    if (!ClientToScreen(owner_, &owner_origin)) {
      *error = "Windows could not locate the Electron content area.";
      return false;
    }
    const double scale = std::max(0.01, bounds.device_scale_factor);
    pixel_width_ = std::max(1, static_cast<int>(std::lround(bounds.width * scale)));
    pixel_height_ = std::max(1, static_cast<int>(std::lround(bounds.height * scale)));
    const int x = owner_origin.x + static_cast<int>(std::lround(bounds.x * scale));
    const int y = owner_origin.y + static_cast<int>(std::lround(bounds.y * scale));
    if (!SetWindowPos(window_, owner_, x, y, pixel_width_, pixel_height_,
                      SWP_NOACTIVATE | SWP_SHOWWINDOW)) {
      *error = "Windows could not position the native libmpv surface.";
      return false;
    }
    return true;
  }

  void Hide() override { ShowWindow(window_, SW_HIDE); }

  bool MakeCurrent(std::string* error) override {
    if (!wglMakeCurrent(device_context_, open_gl_context_)) {
      *error = "Windows could not activate the libmpv OpenGL context.";
      return false;
    }
    return true;
  }

  void SwapBuffers() override { ::SwapBuffers(device_context_); }

  void* GetProcAddress(const char* name) override {
    void* address = reinterpret_cast<void*>(wglGetProcAddress(name));
    if (address != nullptr) return address;
    static HMODULE open_gl = LoadLibraryW(L"opengl32.dll");
    return open_gl ? reinterpret_cast<void*>(GetProcAddress(open_gl, name)) : nullptr;
  }

  int PixelWidth() const override { return pixel_width_; }
  int PixelHeight() const override { return pixel_height_; }

 private:
  HWND owner_;
  HWND window_;
  HDC device_context_;
  HGLRC open_gl_context_;
  int pixel_width_ = 1;
  int pixel_height_ = 1;
};

}  // namespace

std::unique_ptr<VideoSurface> VideoSurface::Create(
    const std::vector<std::uint8_t>& owner_handle, std::string* error) {
  if (owner_handle.empty()) {
    *error = "Electron returned an empty native window handle.";
    return nullptr;
  }
  if (!RegisterSurfaceClass(error)) return nullptr;
  HWND owner = ReadHandle<HWND>(owner_handle);
  HWND window = CreateWindowExW(
      WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, kWindowClassName, L"", WS_POPUP,
      0, 0, 1, 1, owner, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!window) {
    *error = "Windows could not create the native libmpv surface.";
    return nullptr;
  }
  HDC device_context = GetDC(window);
  PIXELFORMATDESCRIPTOR format{};
  format.nSize = sizeof(format);
  format.nVersion = 1;
  format.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
  format.iPixelType = PFD_TYPE_RGBA;
  format.cColorBits = 32;
  format.cAlphaBits = 8;
  format.cDepthBits = 24;
  const int format_index = ChoosePixelFormat(device_context, &format);
  if (format_index == 0 || !SetPixelFormat(device_context, format_index, &format)) {
    ReleaseDC(window, device_context);
    DestroyWindow(window);
    *error = "Windows could not configure the libmpv OpenGL pixel format.";
    return nullptr;
  }
  HGLRC open_gl_context = wglCreateContext(device_context);
  if (!open_gl_context) {
    ReleaseDC(window, device_context);
    DestroyWindow(window);
    *error = "Windows could not create the libmpv OpenGL context.";
    return nullptr;
  }
  return std::make_unique<Win32VideoSurface>(owner, window, device_context,
                                              open_gl_context);
}

#elif defined(__linux__)

#include <GL/glx.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>

namespace {

unsigned long ReadX11Window(const std::vector<std::uint8_t>& bytes) {
  unsigned long value = 0;
  std::memcpy(&value, bytes.data(), std::min(bytes.size(), sizeof(value)));
  return value;
}

class X11VideoSurface final : public VideoSurface {
 public:
  X11VideoSurface(Display* display, ::Window owner, ::Window window,
                  GLXContext open_gl_context, Colormap colormap)
      : display_(display),
        owner_(owner),
        window_(window),
        open_gl_context_(open_gl_context),
        colormap_(colormap) {}

  ~X11VideoSurface() override {
    glXMakeCurrent(display_, None, nullptr);
    if (open_gl_context_) glXDestroyContext(display_, open_gl_context_);
    if (window_) XDestroyWindow(display_, window_);
    if (colormap_) XFreeColormap(display_, colormap_);
    if (display_) XCloseDisplay(display_);
  }

  bool Show(const SurfaceBounds& bounds, std::string* error) override {
    ::Window ignored_child = None;
    int owner_x = 0;
    int owner_y = 0;
    if (!XTranslateCoordinates(display_, owner_, DefaultRootWindow(display_),
                               0, 0, &owner_x, &owner_y, &ignored_child)) {
      *error = "X11 could not locate the Electron content area.";
      return false;
    }
    const double scale = std::max(0.01, bounds.device_scale_factor);
    pixel_width_ = std::max(1, static_cast<int>(std::lround(bounds.width * scale)));
    pixel_height_ = std::max(1, static_cast<int>(std::lround(bounds.height * scale)));
    const int x = owner_x + static_cast<int>(std::lround(bounds.x * scale));
    const int y = owner_y + static_cast<int>(std::lround(bounds.y * scale));
    XMoveResizeWindow(display_, window_, x, y, pixel_width_, pixel_height_);
    XMapWindow(display_, window_);
    XWindowChanges stacking{};
    stacking.sibling = owner_;
    stacking.stack_mode = Below;
    XConfigureWindow(display_, window_, CWSibling | CWStackMode, &stacking);
    XFlush(display_);
    return true;
  }

  void Hide() override {
    XUnmapWindow(display_, window_);
    XFlush(display_);
  }

  bool MakeCurrent(std::string* error) override {
    if (!glXMakeCurrent(display_, window_, open_gl_context_)) {
      *error = "X11 could not activate the libmpv OpenGL context.";
      return false;
    }
    return true;
  }

  void SwapBuffers() override { glXSwapBuffers(display_, window_); }

  void* GetProcAddress(const char* name) override {
    return reinterpret_cast<void*>(
        glXGetProcAddressARB(reinterpret_cast<const GLubyte*>(name)));
  }

  int PixelWidth() const override { return pixel_width_; }
  int PixelHeight() const override { return pixel_height_; }

 private:
  Display* display_;
  ::Window owner_;
  ::Window window_;
  GLXContext open_gl_context_;
  Colormap colormap_;
  int pixel_width_ = 1;
  int pixel_height_ = 1;
};

}  // namespace

std::unique_ptr<VideoSurface> VideoSurface::Create(
    const std::vector<std::uint8_t>& owner_handle, std::string* error) {
  if (owner_handle.empty()) {
    *error = "Electron returned an empty native window handle.";
    return nullptr;
  }
  Display* display = XOpenDisplay(nullptr);
  if (!display) {
    *error = "libmpv requires an X11 display. Start Electron through XWayland on Wayland.";
    return nullptr;
  }

  const int screen = DefaultScreen(display);
  const int attributes[] = {GLX_X_RENDERABLE, True,
                            GLX_DRAWABLE_TYPE, GLX_WINDOW_BIT,
                            GLX_RENDER_TYPE, GLX_RGBA_BIT,
                            GLX_X_VISUAL_TYPE, GLX_TRUE_COLOR,
                            GLX_RED_SIZE, 8,
                            GLX_GREEN_SIZE, 8,
                            GLX_BLUE_SIZE, 8,
                            GLX_ALPHA_SIZE, 8,
                            GLX_DEPTH_SIZE, 24,
                            GLX_DOUBLEBUFFER, True,
                            None};
  int config_count = 0;
  GLXFBConfig* configs = glXChooseFBConfig(display, screen, attributes,
                                           &config_count);
  if (!configs || config_count == 0) {
    if (configs) XFree(configs);
    XCloseDisplay(display);
    *error = "X11 could not find an OpenGL framebuffer for libmpv.";
    return nullptr;
  }
  GLXFBConfig config = configs[0];
  XVisualInfo* visual = glXGetVisualFromFBConfig(display, config);
  XFree(configs);
  if (!visual) {
    XCloseDisplay(display);
    *error = "X11 could not resolve the libmpv OpenGL visual.";
    return nullptr;
  }

  Colormap colormap = XCreateColormap(display, RootWindow(display, screen),
                                      visual->visual, AllocNone);
  XSetWindowAttributes window_attributes{};
  window_attributes.colormap = colormap;
  window_attributes.border_pixel = 0;
  window_attributes.override_redirect = True;
  ::Window window = XCreateWindow(
      display, RootWindow(display, screen), 0, 0, 1, 1, 0, visual->depth,
      InputOutput, visual->visual, CWColormap | CWBorderPixel | CWOverrideRedirect,
      &window_attributes);
  GLXContext context = glXCreateNewContext(display, config, GLX_RGBA_TYPE,
                                            nullptr, True);
  XFree(visual);
  if (!window || !context) {
    if (context) glXDestroyContext(display, context);
    if (window) XDestroyWindow(display, window);
    XFreeColormap(display, colormap);
    XCloseDisplay(display);
    *error = "X11 could not create the native libmpv OpenGL surface.";
    return nullptr;
  }

  const ::Window owner = ReadX11Window(owner_handle);
  XSetTransientForHint(display, window, owner);
  return std::make_unique<X11VideoSurface>(display, owner, window, context,
                                           colormap);
}

#else

std::unique_ptr<VideoSurface> VideoSurface::Create(
    const std::vector<std::uint8_t>&, std::string* error) {
  *error = "This platform does not have a Multiplex libmpv video surface.";
  return nullptr;
}

#endif

#include "video_surface.h"

#import <Cocoa/Cocoa.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace {

template <typename T>
T ReadHandle(const std::vector<std::uint8_t>& bytes) {
  std::uintptr_t value = 0;
  std::memcpy(&value, bytes.data(), std::min(bytes.size(), sizeof(value)));
  return (__bridge T)(reinterpret_cast<void*>(value));
}

class CocoaVideoSurface final : public VideoSurface {
 public:
  CocoaVideoSurface(NSWindow* owner, NSWindow* window,
                    NSOpenGLContext* open_gl_context)
      : owner_(owner), window_(window), open_gl_context_(open_gl_context) {}

  ~CocoaVideoSurface() override {
    [open_gl_context_ clearDrawable];
    [owner_ removeChildWindow:window_];
    [window_ orderOut:nil];
  }

  bool Show(const SurfaceBounds& bounds, std::string*) override {
    NSView* content = [owner_ contentView];
    const NSRect content_bounds = [content bounds];
    const NSRect local = NSMakeRect(bounds.x,
                                    NSHeight(content_bounds) - bounds.y - bounds.height,
                                    std::max(1.0, bounds.width),
                                    std::max(1.0, bounds.height));
    const NSRect frame = [owner_ convertRectToScreen:[content convertRect:local toView:nil]];
    [window_ setFrame:frame display:YES];
    if ([window_ parentWindow] != owner_) {
      [owner_ addChildWindow:window_ ordered:NSWindowBelow];
    }
    [window_ orderWindow:NSWindowBelow relativeTo:[owner_ windowNumber]];
    [open_gl_context_ update];
    const CGFloat scale = [window_ backingScaleFactor];
    pixel_width_ = std::max(1, static_cast<int>(std::lround(bounds.width * scale)));
    pixel_height_ = std::max(1, static_cast<int>(std::lround(bounds.height * scale)));
    return true;
  }

  void Hide() override { [window_ orderOut:nil]; }

  bool MakeCurrent(std::string*) override {
    [open_gl_context_ makeCurrentContext];
    return true;
  }

  void SwapBuffers() override { [open_gl_context_ flushBuffer]; }

  void* GetProcAddress(const char* name) override {
    CFBundleRef framework = CFBundleGetBundleWithIdentifier(CFSTR("com.apple.opengl"));
    if (!framework) return nullptr;
    CFStringRef symbol = CFStringCreateWithCString(
        kCFAllocatorDefault, name, kCFStringEncodingASCII);
    void* address = reinterpret_cast<void*>(
        CFBundleGetFunctionPointerForName(framework, symbol));
    CFRelease(symbol);
    return address;
  }

  int PixelWidth() const override { return pixel_width_; }
  int PixelHeight() const override { return pixel_height_; }

 private:
  __strong NSWindow* owner_;
  __strong NSWindow* window_;
  __strong NSOpenGLContext* open_gl_context_;
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
  NSView* owner_view = ReadHandle<NSView*>(owner_handle);
  NSWindow* owner = [owner_view window];
  if (!owner) {
    *error = "macOS could not resolve Electron's native window.";
    return nullptr;
  }

  NSOpenGLPixelFormatAttribute attributes[] = {
      NSOpenGLPFAAccelerated,
      NSOpenGLPFADoubleBuffer,
      NSOpenGLPFAColorSize, 24,
      NSOpenGLPFAAlphaSize, 8,
      NSOpenGLPFADepthSize, 24,
      0,
  };
  NSOpenGLPixelFormat* format =
      [[NSOpenGLPixelFormat alloc] initWithAttributes:attributes];
  NSOpenGLContext* context =
      [[NSOpenGLContext alloc] initWithFormat:format shareContext:nil];
  NSWindow* window = [[NSWindow alloc]
      initWithContentRect:NSMakeRect(0, 0, 1, 1)
                styleMask:NSWindowStyleMaskBorderless
                  backing:NSBackingStoreBuffered
                    defer:NO];
  if (!format || !context || !window) {
    *error = "macOS could not create the native libmpv OpenGL surface.";
    return nullptr;
  }
  [window setOpaque:YES];
  [window setBackgroundColor:[NSColor blackColor]];
  [window setIgnoresMouseEvents:YES];
  [window setHasShadow:NO];
  [window setReleasedWhenClosed:NO];
  [window setCollectionBehavior:NSWindowCollectionBehaviorFullScreenAuxiliary |
                                NSWindowCollectionBehaviorIgnoresCycle];
  [context setView:[window contentView]];
  return std::make_unique<CocoaVideoSurface>(owner, window, context);
}

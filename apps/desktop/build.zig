const std = @import("std");
const native_sdk = @import("native_sdk");

pub fn build(b: *std.Build) void {
    const dependency = b.dependency("native_sdk", .{});
    native_sdk.addApp(b, dependency, .{
        .name = "multiplex-desktop",
    });
}

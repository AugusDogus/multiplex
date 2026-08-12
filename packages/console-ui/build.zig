const std = @import("std");
const native_sdk = @import("native_sdk");

const frame_capacity = 128 * 1024;
const heap_capacity = 256 * 1024;

pub fn build(b: *std.Build) void {
    const dependency = b.dependency("native_sdk", .{});

    // Keep the upstream null-platform build as the first compatibility gate.
    // It compiles the TypeScript core, generated wiring, and declarative view.
    native_sdk.addApp(b, dependency, .{ .name = "multiplex-console-ui" });

    const target_triple = b.option(
        []const u8,
        "console-target",
        "Target triple for the freestanding console UI archive",
    ) orelse "powerpc-freestanding-eabi";
    const target_cpu = b.option(
        []const u8,
        "console-cpu",
        "CPU model and features for the freestanding console UI archive",
    ) orelse "750";
    const target_query = std.Target.Query.parse(.{
        .arch_os_abi = target_triple,
        .cpu_features = target_cpu,
    }) catch @panic("invalid console target or CPU");
    const target = b.resolveTargetQuery(target_query);
    const optimize = b.option(
        std.builtin.OptimizeMode,
        "console-optimize",
        "Optimization mode for the freestanding console UI archive",
    ) orelse .ReleaseFast;
    addConsoleCore(b, dependency, target, optimize);
}

/// Compile the generated TypeScript application core for a caller-selected
/// freestanding console target. The default remains PowerPC 750 EABI for the
/// current libogc hosts.
fn addConsoleCore(
    b: *std.Build,
    dependency: *std.Build.Dependency,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) void {
    const transpile = b.addSystemCommand(&.{"node"});
    transpile.addFileArg(dependency.path("build/ts_run.mjs"));
    transpile.addFileArg(dependency.path("packages/core/src/cli.ts"));
    transpile.addFileArg(b.path("src/core.ts"));
    transpile.addArg("-o");
    const emitted_core = transpile.addOutputFileArg("core.zig");
    transpile.addArgs(&.{
        "--frame-cap",
        b.fmt("{d}", .{frame_capacity}),
        "--heap-cap",
        b.fmt("{d}", .{heap_capacity}),
    });

    const staged = b.addWriteFiles();
    _ = staged.addCopyFile(emitted_core, "core.zig");
    _ = staged.addCopyFile(dependency.path("packages/core/rt/rt.zig"), "rt.zig");
    _ = staged.addCopyFile(b.path("src/app.native"), "app.native");
    _ = staged.addCopyFile(b.path("src/icons/back.svg"), "icons/back.svg");
    _ = staged.addCopyFile(b.path("src/icons/back-10.svg"), "icons/back-10.svg");
    _ = staged.addCopyFile(b.path("src/icons/forward-30.svg"), "icons/forward-30.svg");
    _ = staged.addCopyFile(b.path("src/icons/home.svg"), "icons/home.svg");
    _ = staged.addCopyFile(b.path("src/icons/multiplex.svg"), "icons/multiplex.svg");
    _ = staged.addCopyFile(b.path("src/icons/stop.svg"), "icons/stop.svg");
    const probe_root = staged.addCopyFile(b.path("src/console_ui.zig"), "console_ui.zig");

    const geometry_module = b.createModule(.{
        .root_source_file = dependency.path("src/primitives/geometry/root.zig"),
        .target = target,
        .optimize = optimize,
        .single_threaded = true,
    });
    const json_module = b.createModule(.{
        .root_source_file = dependency.path("src/primitives/json/root.zig"),
        .target = target,
        .optimize = optimize,
        .single_threaded = true,
    });
    const canvas_module = b.createModule(.{
        .root_source_file = dependency.path("src/primitives/canvas/root.zig"),
        .target = target,
        .optimize = optimize,
        .single_threaded = true,
    });
    canvas_module.addImport("geometry", geometry_module);
    canvas_module.addImport("json", json_module);

    const probe_module = b.createModule(.{
        .root_source_file = probe_root,
        .target = target,
        .optimize = optimize,
        .single_threaded = true,
    });
    probe_module.addImport("canvas", canvas_module);
    probe_module.addImport("geometry", geometry_module);
    const probe = b.addLibrary(.{
        .name = "multiplex-console-ui",
        .linkage = .static,
        .root_module = probe_module,
        .use_llvm = true,
    });
    probe.bundle_compiler_rt = true;
    const install = b.addInstallFileWithDir(
        probe.getEmittedBin(),
        .lib,
        "libmultiplex-console-ui.a",
    );

    const step = b.step(
        "console-core",
        "Compile the console UI for the selected freestanding target",
    );
    step.dependOn(&install.step);
}

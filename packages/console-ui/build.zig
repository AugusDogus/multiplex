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
    addCoreArchive(b, dependency, .{
        .target = target,
        .optimize = optimize,
        .library_name = "multiplex-console-ui",
        .installed_name = "libmultiplex-console-ui.a",
        .step_name = "console-core",
        .step_description = "Compile the console UI for the selected freestanding target",
    });
    addCoreArchive(b, dependency, .{
        .target = b.graph.host,
        .optimize = .ReleaseFast,
        .library_name = "multiplex-console-ui-host",
        .installed_name = "libmultiplex-console-ui-host.a",
        .step_name = "host-core",
        .step_description = "Compile the console UI for host-side reference frame export",
    });
}

const CoreArchiveOptions = struct {
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    library_name: []const u8,
    installed_name: []const u8,
    step_name: []const u8,
    step_description: []const u8,
};

/// Compile the generated TypeScript application core for a selected target.
fn addCoreArchive(
    b: *std.Build,
    dependency: *std.Build.Dependency,
    options: CoreArchiveOptions,
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
        .target = options.target,
        .optimize = options.optimize,
        .single_threaded = true,
    });
    const json_module = b.createModule(.{
        .root_source_file = dependency.path("src/primitives/json/root.zig"),
        .target = options.target,
        .optimize = options.optimize,
        .single_threaded = true,
    });
    const canvas_module = b.createModule(.{
        .root_source_file = dependency.path("src/primitives/canvas/root.zig"),
        .target = options.target,
        .optimize = options.optimize,
        .single_threaded = true,
    });
    canvas_module.addImport("geometry", geometry_module);
    canvas_module.addImport("json", json_module);

    const probe_module = b.createModule(.{
        .root_source_file = probe_root,
        .target = options.target,
        .optimize = options.optimize,
        .single_threaded = true,
    });
    probe_module.addImport("canvas", canvas_module);
    probe_module.addImport("geometry", geometry_module);
    const probe = b.addLibrary(.{
        .name = options.library_name,
        .linkage = .static,
        .root_module = probe_module,
        .use_llvm = true,
    });
    probe.bundle_compiler_rt = true;
    const install = b.addInstallFileWithDir(
        probe.getEmittedBin(),
        .lib,
        options.installed_name,
    );

    const step = b.step(options.step_name, options.step_description);
    step.dependOn(&install.step);
}

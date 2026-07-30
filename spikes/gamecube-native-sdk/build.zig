const std = @import("std");
const native_sdk = @import("native_sdk");

const frame_capacity = 128 * 1024;
const heap_capacity = 256 * 1024;

pub fn build(b: *std.Build) void {
    const dependency = b.dependency("native_sdk", .{});

    // Keep the upstream null-platform build as the first compatibility gate.
    // It compiles the TypeScript core, generated wiring, and declarative view.
    native_sdk.addApp(b, dependency, .{ .name = "multiplex-gamecube-spike" });

    addGameCubeCoreProbe(b, dependency);
}

/// Compile the generated TypeScript application core as a freestanding
/// PowerPC 750 EABI object. This deliberately excludes Native SDK's desktop
/// runtime and renderer: it answers the first question independently—
/// whether our authored state machine and its fixed-capacity runtime can
/// become code for the GameCube CPU.
fn addGameCubeCoreProbe(b: *std.Build, dependency: *std.Build.Dependency) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .powerpc,
        .cpu_model = .{ .explicit = &std.Target.powerpc.cpu.@"750" },
        .os_tag = .freestanding,
        .abi = .eabi,
    });

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
    _ = staged.addCopyFile(b.path("src/icons/multiplex.svg"), "icons/multiplex.svg");
    const probe_root = staged.addCopyFile(b.path("src/gamecube_probe.zig"), "gamecube_probe.zig");

    const geometry_module = b.createModule(.{
        .root_source_file = dependency.path("src/primitives/geometry/root.zig"),
        .target = target,
        .optimize = .ReleaseSmall,
        .single_threaded = true,
    });
    const json_module = b.createModule(.{
        .root_source_file = dependency.path("src/primitives/json/root.zig"),
        .target = target,
        .optimize = .ReleaseSmall,
        .single_threaded = true,
    });
    const canvas_module = b.createModule(.{
        .root_source_file = dependency.path("src/primitives/canvas/root.zig"),
        .target = target,
        .optimize = .ReleaseSmall,
        .single_threaded = true,
    });
    canvas_module.addImport("geometry", geometry_module);
    canvas_module.addImport("json", json_module);

    const probe_module = b.createModule(.{
        .root_source_file = probe_root,
        .target = target,
        .optimize = .ReleaseSmall,
        .single_threaded = true,
    });
    probe_module.addImport("canvas", canvas_module);
    probe_module.addImport("geometry", geometry_module);
    const probe = b.addLibrary(.{
        .name = "multiplex-gamecube-core",
        .linkage = .static,
        .root_module = probe_module,
        .use_llvm = true,
    });
    probe.bundle_compiler_rt = true;
    const install = b.addInstallFileWithDir(
        probe.getEmittedBin(),
        .lib,
        "libmultiplex-gamecube-core.a",
    );

    const step = b.step(
        "gamecube-core",
        "Compile the TypeScript core and compiled .native view as a PowerPC 750 EABI object",
    );
    step.dependOn(&install.step);
}

//! Freestanding ABI probe for the TypeScript-authored Multiplex core.
//!
//! The generated `core.zig` and its fixed-capacity runtime are staged beside
//! this file by build.zig. Exported C-ABI functions keep the relevant core
//! paths alive in the PowerPC object and give the future libogc2 host a tiny,
//! stable seam to call.

const std = @import("std");
const core = @import("core.zig");
const canvas = @import("canvas");
const geometry = @import("geometry");

const CompiledView = canvas.CompiledMarkupView(
    core.Model,
    core.Msg,
    @embedFile("app.native"),
);
const ui_arena_capacity = 256 * 1024;
const reference_width: usize = 640;
const reference_height: usize = 480;
const reference_pixel_bytes: usize = reference_width * reference_height * 4;
const reference_memo_budget_bytes: usize = 4 * 1024 * 1024;
var ui_arena: [ui_arena_capacity]u8 = undefined;
var layout_nodes: [256]canvas.WidgetLayoutNode = undefined;
var display_commands: [512]canvas.CanvasCommand = undefined;
var display_builder: canvas.Builder = undefined;
var render_commands: [512]canvas.RenderCommand = undefined;
var gpu_commands: [512]canvas.CanvasGpuCommand = undefined;
var app_model: *const core.Model = undefined;
var app_initialized = false;
var focused_handler: usize = 0;
var reference_render_stage: u32 = 0;
var reference_full_repaint = true;
var previous_render_state: canvas.WidgetRenderState = .{};
var previous_render_state_valid = false;
var reference_memo_allocator: BoundedMemoAllocator = .{};
var reference_render_memo: canvas.ReferenceRenderMemo = undefined;
var reference_render_memo_initialized = false;

extern fn multiplex_native_profile_mark(stage: u32) callconv(.c) void;
extern fn multiplex_native_cache_alloc(len: u32, alignment: u32) callconv(.c) ?[*]u8;
extern fn multiplex_native_cache_free(memory: [*]u8) callconv(.c) void;

const BoundedMemoAllocator = struct {
    bytes_in_use: usize = 0,
    peak_bytes: usize = 0,

    const vtable: std.mem.Allocator.VTable = .{
        .alloc = alloc,
        .resize = resize,
        .remap = remap,
        .free = free,
    };

    fn allocator(self: *BoundedMemoAllocator) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &vtable };
    }

    fn alloc(
        context: *anyopaque,
        len: usize,
        alignment: std.mem.Alignment,
        return_address: usize,
    ) ?[*]u8 {
        _ = return_address;
        const self: *BoundedMemoAllocator = @ptrCast(@alignCast(context));
        if (len == 0 or len > reference_memo_budget_bytes -| self.bytes_in_use) return null;
        const memory = multiplex_native_cache_alloc(
            @intCast(len),
            @intCast(alignment.toByteUnits()),
        ) orelse return null;
        self.bytes_in_use += len;
        self.peak_bytes = @max(self.peak_bytes, self.bytes_in_use);
        return memory;
    }

    fn resize(
        context: *anyopaque,
        memory: []u8,
        alignment: std.mem.Alignment,
        new_len: usize,
        return_address: usize,
    ) bool {
        _ = context;
        _ = memory;
        _ = alignment;
        _ = new_len;
        _ = return_address;
        return false;
    }

    fn remap(
        context: *anyopaque,
        memory: []u8,
        alignment: std.mem.Alignment,
        new_len: usize,
        return_address: usize,
    ) ?[*]u8 {
        _ = context;
        _ = memory;
        _ = alignment;
        _ = new_len;
        _ = return_address;
        return null;
    }

    fn free(
        context: *anyopaque,
        memory: []u8,
        alignment: std.mem.Alignment,
        return_address: usize,
    ) void {
        _ = alignment;
        _ = return_address;
        const self: *BoundedMemoAllocator = @ptrCast(@alignCast(context));
        self.bytes_in_use -|= memory.len;
        multiplex_native_cache_free(memory.ptr);
    }
};

fn referenceRenderMemo() *canvas.ReferenceRenderMemo {
    if (!reference_render_memo_initialized) {
        reference_render_memo = canvas.ReferenceRenderMemo.init(reference_memo_allocator.allocator());
        reference_render_memo_initialized = true;
    }
    return &reference_render_memo;
}

pub const GxCommand = extern struct {
    kind: u32 = 0,
    x: f32 = 0,
    y: f32 = 0,
    width: f32 = 0,
    height: f32 = 0,
    x2: f32 = 0,
    y2: f32 = 0,
    radius: f32 = 0,
    stroke_width: f32 = 0,
    color_rgba: u32 = 0,
    has_clip: u32 = 0,
    clip_x: f32 = 0,
    clip_y: f32 = 0,
    clip_width: f32 = 0,
    clip_height: f32 = 0,
    text_ptr: ?[*]const u8 = null,
    text_len: u32 = 0,
    glyph_id: u32 = 0,
    font_size: f32 = 0,
};

const gx_fill_rect: u32 = 1;
const gx_fill_rounded_rect: u32 = 2;
const gx_stroke_rect: u32 = 3;
const gx_line: u32 = 4;
const gx_text: u32 = 5;
const gx_shadow: u32 = 6;
const gx_glyph: u32 = 7;

export fn multiplex_core_abi_version() callconv(.c) u32 {
    return 1;
}

export fn multiplex_core_initial_selection() callconv(.c) i64 {
    core.rt.resetAll();
    return core.initialModel().selectedIndex;
}

export fn multiplex_core_selection_after_next() callconv(.c) i64 {
    core.rt.resetAll();
    const initial = core.initialModel();
    const connected = core.update(initial, .connect_demo);
    const next = core.update(connected, .next);
    return next.selectedIndex;
}

/// Build the authored `.native` document on the target CPU and return its
/// live structural shape: high 16 bits are widgets, low 16 bits handlers.
export fn multiplex_native_pairing_view_summary() callconv(.c) u32 {
    core.rt.resetAll();
    const model = core.initialModel();
    return buildViewSummary(model);
}

/// Resolve the first press handler from the compiled pairing view, feed its
/// message into the TypeScript update function, then rebuild the resulting
/// home view. This crosses the complete model -> view -> input -> model seam.
export fn multiplex_native_home_view_summary() callconv(.c) u32 {
    core.rt.resetAll();
    var model = core.initialModel();

    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const pairing = ui.finalizeWithTokens(CompiledView.build(&ui, model), .{}) catch return 0;
    if (pairing.handlers.len == 0) return 0;
    const msg = pairing.msgFor(pairing.handlers[0].id, .press) orelse return 0;
    model = core.update(model, msg);

    return buildViewSummary(model);
}

/// Run the live home view through Native SDK's layout and widget renderer.
/// High 16 bits are laid-out nodes, low 16 bits are emitted draw commands.
export fn multiplex_native_home_render_summary() callconv(.c) u32 {
    core.rt.resetAll();
    var model = core.initialModel();

    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const pairing = ui.finalizeWithTokens(CompiledView.build(&ui, model), .{}) catch return 0;
    if (pairing.handlers.len == 0) return 0;
    const msg = pairing.msgFor(pairing.handlers[0].id, .press) orelse return 0;
    model = core.update(model, msg);

    fixed.reset();
    ui = CompiledView.Ui.init(fixed.allocator());
    const home = ui.finalizeWithTokens(CompiledView.build(&ui, model), .{}) catch return 0;
    const layout = canvas.layoutWidgetTreeWithTokens(
        home.root,
        geometry.RectF.init(0, 0, 640, 480),
        .{},
        &layout_nodes,
    ) catch return 0;

    display_builder = canvas.Builder.init(&display_commands);
    layout.emitDisplayList(&display_builder, .{}) catch return 0;
    const node_count: u32 = @intCast(layout.nodeCount());
    const command_count: u32 = @intCast(display_builder.displayList().commandCount());
    return (node_count << 16) | command_count;
}

/// Diagnostic for the port seam: high 16 bits are nodes with non-empty
/// frames, low 16 bits are commands from the pre-layout tree emitter.
export fn multiplex_native_home_emit_diagnostic() callconv(.c) u32 {
    core.rt.resetAll();
    var model = core.initialModel();

    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const pairing = ui.finalizeWithTokens(CompiledView.build(&ui, model), .{}) catch return 0;
    if (pairing.handlers.len == 0) return 0;
    const msg = pairing.msgFor(pairing.handlers[0].id, .press) orelse return 0;
    model = core.update(model, msg);

    fixed.reset();
    ui = CompiledView.Ui.init(fixed.allocator());
    const home = ui.finalizeWithTokens(CompiledView.build(&ui, model), .{}) catch return 0;
    const layout = canvas.layoutWidgetTreeWithTokens(
        home.root,
        geometry.RectF.init(0, 0, 640, 480),
        .{},
        &layout_nodes,
    ) catch return 0;

    var non_empty: u32 = 0;
    for (layout.nodes) |node| {
        if (node.frame.width > 0 and node.frame.height > 0) non_empty += 1;
    }

    display_builder = canvas.Builder.init(&display_commands);
    canvas.emitWidgetTree(&display_builder, home.root, .{}) catch return 0;
    const command_count: u32 = @intCast(display_builder.displayList().commandCount());
    return (non_empty << 16) | command_count;
}

fn initializeApp() void {
    core.rt.resetAll();
    app_model = core.commitModelRoot(core.initialModel());
    app_initialized = true;
    focused_handler = 0;
    reference_full_repaint = true;
    previous_render_state = .{};
    previous_render_state_valid = false;
}

export fn multiplex_native_app_init() callconv(.c) void {
    initializeApp();
}

/// 0/1 move focus backward/forward, 2 activates the focused `.native`
/// handler, and 3 dispatches the console Back message.
export fn multiplex_native_app_input(action: u32) callconv(.c) u32 {
    if (!app_initialized) return 0;
    const model = app_model;
    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const tree = ui.finalizeWithTokens(CompiledView.build(&ui, model), .{}) catch return 0;

    var press_ids: [16]canvas.ObjectId = undefined;
    var press_count: usize = 0;
    for (tree.handlers) |handler| {
        if (tree.msgFor(handler.id, .press) == null) continue;
        var duplicate = false;
        for (press_ids[0..press_count]) |id| {
            if (id == handler.id) duplicate = true;
        }
        if (!duplicate and press_count < press_ids.len) {
            press_ids[press_count] = handler.id;
            press_count += 1;
        }
    }
    if (action == 3) {
        app_model = core.commitModelRoot(core.update(model, .back));
        focused_handler = 0;
        reference_full_repaint = true;
        return 1;
    }
    if (press_count == 0) return 0;
    if (focused_handler >= press_count) focused_handler = 0;

    switch (action) {
        0 => {
            focused_handler = if (focused_handler == 0) press_count - 1 else focused_handler - 1;
            reference_full_repaint = false;
        },
        1 => {
            focused_handler = (focused_handler + 1) % press_count;
            reference_full_repaint = false;
        },
        2 => {
            const msg = tree.msgFor(press_ids[focused_handler], .press) orelse return 0;
            app_model = core.commitModelRoot(core.update(model, msg));
            focused_handler = 0;
            reference_full_repaint = true;
        },
        else => return 0,
    }
    return 1;
}

/// Build the current live app frame and lower Native SDK's GPU packet into
/// the deliberately small command ABI consumed by the libogc GX presenter.
export fn multiplex_native_app_render(output: [*]GxCommand, capacity: u32) callconv(.c) u32 {
    if (!app_initialized) return 0;
    const model = app_model;
    const tokens = canvas.DesignTokens.theme(.{
        .pack = .geist,
        .color_scheme = .dark,
    });
    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const tree = ui.finalizeWithTokens(CompiledView.build(&ui, model), tokens) catch return 0;
    const layout = canvas.layoutWidgetTreeWithTokens(
        tree.root,
        geometry.RectF.init(0, 0, 640, 480),
        tokens,
        &layout_nodes,
    ) catch return 0;

    var press_ids: [16]canvas.ObjectId = undefined;
    var press_count: usize = 0;
    for (tree.handlers) |handler| {
        if (tree.msgFor(handler.id, .press) == null) continue;
        var duplicate = false;
        for (press_ids[0..press_count]) |id| {
            if (id == handler.id) duplicate = true;
        }
        if (!duplicate and press_count < press_ids.len) {
            press_ids[press_count] = handler.id;
            press_count += 1;
        }
    }
    if (press_count > 0 and focused_handler >= press_count) focused_handler = 0;
    const focused_id: ?canvas.ObjectId = if (press_count > 0) press_ids[focused_handler] else null;

    display_builder = canvas.Builder.init(&display_commands);
    layout.emitDisplayListWithState(&display_builder, tokens, .{
        .focused_id = focused_id,
        .focus_visible_id = focused_id,
    }) catch return 0;
    const render_plan = display_builder.displayList().renderPlan(&render_commands) catch return 0;
    var packet_planner = canvas.CanvasGpuPacketPlanner.init(&gpu_commands);
    const packet = packet_planner.build(.{
        .frame_index = 1,
        .surface_size = .{ .width = 640, .height = 480 },
        .scale = 1,
        .full_repaint = true,
        .dirty_bounds = geometry.RectF.init(0, 0, 640, 480),
        .commands = render_plan.commands,
    }) catch return 0;

    var output_len: usize = 0;
    for (packet.commands) |command| {
        if (output_len >= capacity) break;
        if (command.kind == .draw_text) {
            if (command.text) |text| {
                if (text.text.len == 0 and text.glyphs.len > 0) {
                    for (text.glyphs) |glyph| {
                        if (output_len >= capacity) break;
                        var translated = GxCommand{
                            .kind = gx_glyph,
                            .x = text.origin.x + glyph.x,
                            .y = text.origin.y + glyph.y,
                            .glyph_id = glyph.id,
                            .font_size = text.size,
                            .color_rgba = colorRgba(text.color, command.opacity),
                        };
                        copyClip(&translated, command.clip);
                        output[output_len] = translated;
                        output_len += 1;
                    }
                    continue;
                }
            }
        }
        if (gxCommand(command)) |translated| {
            output[output_len] = translated;
            output_len += 1;
        }
    }
    return @intCast(output_len);
}

/// Render the live app with Native SDK's deterministic CPU reference
/// renderer. The console host owns both buffers so this ABI stays useful for
/// raylib, direct GX, and later console presenters.
export fn multiplex_native_reference_pixel_bytes() callconv(.c) u32 {
    return reference_pixel_bytes;
}

export fn multiplex_native_reference_render_stage() callconv(.c) u32 {
    return reference_render_stage;
}

export fn multiplex_native_reference_memo_hits() callconv(.c) u32 {
    return if (reference_render_memo_initialized) @truncate(reference_render_memo.hits) else 0;
}

export fn multiplex_native_reference_memo_misses() callconv(.c) u32 {
    return if (reference_render_memo_initialized) @truncate(reference_render_memo.misses) else 0;
}

export fn multiplex_native_reference_memo_bytes() callconv(.c) u32 {
    return @intCast(reference_memo_allocator.bytes_in_use);
}

export fn multiplex_native_reference_memo_peak_bytes() callconv(.c) u32 {
    return @intCast(reference_memo_allocator.peak_bytes);
}

fn renderReference(
    model: *const core.Model,
    pixels_ptr: [*]u8,
    pixels_capacity: u32,
    scratch_ptr: [*]u8,
    scratch_capacity: u32,
) u32 {
    reference_render_stage = 1;
    multiplex_native_profile_mark(reference_render_stage);
    if (pixels_capacity < reference_pixel_bytes or scratch_capacity < reference_pixel_bytes) {
        reference_render_stage = 0x101;
        return 0;
    }
    const tokens = canvas.DesignTokens.theme(.{
        .pack = .geist,
        .color_scheme = .dark,
    });
    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const tree = ui.finalizeWithTokens(CompiledView.build(&ui, model), tokens) catch {
        reference_render_stage = 0x103;
        return 0;
    };
    reference_render_stage = 2;
    multiplex_native_profile_mark(reference_render_stage);
    const layout = canvas.layoutWidgetTreeWithTokens(
        tree.root,
        geometry.RectF.init(0, 0, reference_width, reference_height),
        tokens,
        &layout_nodes,
    ) catch {
        reference_render_stage = 0x104;
        return 0;
    };
    reference_render_stage = 3;
    multiplex_native_profile_mark(reference_render_stage);

    var press_ids: [16]canvas.ObjectId = undefined;
    var press_count: usize = 0;
    for (tree.handlers) |handler| {
        if (tree.msgFor(handler.id, .press) == null) continue;
        var duplicate = false;
        for (press_ids[0..press_count]) |id| {
            if (id == handler.id) duplicate = true;
        }
        if (!duplicate and press_count < press_ids.len) {
            press_ids[press_count] = handler.id;
            press_count += 1;
        }
    }
    if (press_count > 0 and focused_handler >= press_count) focused_handler = 0;
    const focused_id: ?canvas.ObjectId = if (press_count > 0) press_ids[focused_handler] else null;
    const render_state = canvas.WidgetRenderState{
        .focused_id = focused_id,
        .focus_visible_id = focused_id,
    };

    display_builder = canvas.Builder.init(&display_commands);
    layout.emitDisplayListWithState(&display_builder, tokens, render_state) catch {
        reference_render_stage = 0x105;
        return 0;
    };
    reference_render_stage = 4;
    multiplex_native_profile_mark(reference_render_stage);
    const render_plan = display_builder.displayList().renderPlan(&render_commands) catch {
        reference_render_stage = 0x106;
        return 0;
    };
    reference_render_stage = 5;
    multiplex_native_profile_mark(reference_render_stage);

    const pixels = pixels_ptr[0..reference_pixel_bytes];
    const scratch = scratch_ptr[0..reference_pixel_bytes];
    const surface = (canvas.ReferenceRenderSurface.initWithScratch(
        reference_width,
        reference_height,
        pixels,
        scratch,
    ) catch {
        reference_render_stage = 0x107;
        return 0;
    }).withRenderMemo(referenceRenderMemo());
    reference_render_stage = 6;
    multiplex_native_profile_mark(reference_render_stage);
    const full_repaint = reference_full_repaint or !previous_render_state_valid;
    const dirty_bounds = if (full_repaint)
        geometry.RectF.init(0, 0, reference_width, reference_height)
    else
        layout.renderStateDirtyBoundsWithTokens(
            previous_render_state,
            render_state,
            tokens,
        );
    surface.renderPass(.{
        .frame_index = 1,
        .surface_size = geometry.SizeF.init(reference_width, reference_height),
        .scale = 1,
        .full_repaint = full_repaint,
        .dirty_bounds = dirty_bounds,
        .commands = render_plan.commands,
    }, canvas.Color.rgb8(10, 10, 12)) catch {
        reference_render_stage = 0x108;
        return 0;
    };

    reference_render_stage = 7;
    multiplex_native_profile_mark(reference_render_stage);
    previous_render_state = render_state;
    previous_render_state_valid = true;
    reference_full_repaint = false;
    return @intCast(render_plan.commands.len);
}

export fn multiplex_native_app_render_reference(
    pixels_ptr: [*]u8,
    pixels_capacity: u32,
    scratch_ptr: [*]u8,
    scratch_capacity: u32,
) callconv(.c) u32 {
    if (!app_initialized) {
        reference_render_stage = 0x102;
        return 0;
    }
    const model = app_model;
    return renderReference(
        model,
        pixels_ptr,
        pixels_capacity,
        scratch_ptr,
        scratch_capacity,
    );
}

export fn multiplex_native_app_init_and_render_reference(
    pixels_ptr: [*]u8,
    pixels_capacity: u32,
    scratch_ptr: [*]u8,
    scratch_capacity: u32,
) callconv(.c) u32 {
    initializeApp();
    return renderReference(
        app_model,
        pixels_ptr,
        pixels_capacity,
        scratch_ptr,
        scratch_capacity,
    );
}

fn gxCommand(command: canvas.CanvasGpuCommand) ?GxCommand {
    var result = GxCommand{};
    copyClip(&result, command.clip);

    switch (command.kind) {
        .fill_rect_solid, .fill_rect_gradient => {
            result.kind = gx_fill_rect;
            setRect(&result, command.bounds);
            result.color_rgba = paintRgba(command.paint, command.opacity);
        },
        .fill_rounded_rect_solid, .fill_rounded_rect_gradient => {
            result.kind = gx_fill_rounded_rect;
            setRect(&result, command.bounds);
            if (command.shape == .rounded_rect) {
                const radius = command.shape.rounded_rect.radius;
                result.radius = @max(@max(radius.top_left, radius.top_right), @max(radius.bottom_left, radius.bottom_right));
            }
            result.color_rgba = paintRgba(command.paint, command.opacity);
        },
        .stroke_rect_solid, .stroke_rect_gradient => {
            result.kind = gx_stroke_rect;
            setRect(&result, command.bounds);
            if (command.shape == .rounded_rect) {
                const radius = command.shape.rounded_rect.radius;
                result.radius = @max(@max(radius.top_left, radius.top_right), @max(radius.bottom_left, radius.bottom_right));
            }
            result.stroke_width = @max(1, command.stroke_width);
            result.color_rgba = paintRgba(command.paint, command.opacity);
        },
        .draw_line_solid, .draw_line_gradient => {
            result.kind = gx_line;
            if (command.shape != .line) return null;
            const line = command.shape.line;
            result.x = line.from.x;
            result.y = line.from.y;
            result.x2 = line.to.x;
            result.y2 = line.to.y;
            result.stroke_width = @max(1, line.width);
            result.color_rgba = paintRgba(command.paint, command.opacity);
        },
        .draw_text => {
            const text = command.text orelse return null;
            result.kind = gx_text;
            result.x = text.origin.x;
            result.y = text.origin.y;
            result.text_ptr = text.text.ptr;
            result.text_len = @intCast(text.text.len);
            result.font_size = text.size;
            result.color_rgba = colorRgba(text.color, command.opacity);
        },
        .shadow => {
            if (command.effect != .shadow) return null;
            const shadow = command.effect.shadow;
            result.kind = gx_shadow;
            result.x = shadow.rect.x + shadow.offset.dx - shadow.spread;
            result.y = shadow.rect.y + shadow.offset.dy - shadow.spread;
            result.width = shadow.rect.width + shadow.spread * 2;
            result.height = shadow.rect.height + shadow.spread * 2;
            result.radius = @max(@max(shadow.radius.top_left, shadow.radius.top_right), @max(shadow.radius.bottom_left, shadow.radius.bottom_right)) + shadow.blur * 0.25;
            result.color_rgba = colorRgba(shadow.color, command.opacity * 0.65);
        },
        else => return null,
    }
    return result;
}

fn copyClip(output: *GxCommand, clip_value: ?geometry.RectF) void {
    output.has_clip = if (clip_value != null) 1 else 0;
    if (clip_value) |clip| {
        output.clip_x = clip.x;
        output.clip_y = clip.y;
        output.clip_width = clip.width;
        output.clip_height = clip.height;
    }
}

fn setRect(output: *GxCommand, rect: geometry.RectF) void {
    output.x = rect.x;
    output.y = rect.y;
    output.width = rect.width;
    output.height = rect.height;
}

fn paintRgba(paint: canvas.CanvasGpuPaint, opacity: f32) u32 {
    return switch (paint) {
        .color => |color| colorRgba(color, opacity),
        .linear_gradient => |gradient| if (gradient.stops.len > 0)
            colorRgba(gradient.stops[0].color, opacity)
        else
            0,
        .none => 0,
    };
}

fn colorRgba(color: canvas.Color, opacity: f32) u32 {
    const r: u32 = channel(color.r);
    const g: u32 = channel(color.g);
    const b: u32 = channel(color.b);
    const a: u32 = channel(color.a * opacity);
    return (r << 24) | (g << 16) | (b << 8) | a;
}

fn channel(value: f32) u32 {
    return @intFromFloat(@round(std.math.clamp(value, 0, 1) * 255));
}

fn buildViewSummary(model: *const core.Model) u32 {
    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const tree = ui.finalizeWithTokens(CompiledView.build(&ui, model), .{}) catch return 0;
    const widget_count: u32 = @intCast(countWidgets(tree.root));
    const handler_count: u32 = @intCast(tree.handlers.len);
    return (widget_count << 16) | handler_count;
}

fn countWidgets(widget: canvas.Widget) usize {
    var count: usize = 1;
    for (widget.children) |child| count += countWidgets(child);
    return count;
}

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

const multiplex_icon = canvas.svg_icon.parseComptime(@embedFile("icons/multiplex.svg"));
const back_icon = canvas.svg_icon.parseComptime(@embedFile("icons/back.svg"));
const back_10_icon = canvas.svg_icon.parseComptime(@embedFile("icons/back-10.svg"));
const forward_30_icon = canvas.svg_icon.parseComptime(@embedFile("icons/forward-30.svg"));
const home_icon = canvas.svg_icon.parseComptime(@embedFile("icons/home.svg"));
const stop_icon = canvas.svg_icon.parseComptime(@embedFile("icons/stop.svg"));

pub const app_icons = [_]canvas.icons.Entry{
    .{ .name = "back", .icon = &back_icon },
    .{ .name = "back-10", .icon = &back_10_icon },
    .{ .name = "forward-30", .icon = &forward_30_icon },
    .{ .name = "home", .icon = &home_icon },
    .{ .name = "multiplex", .icon = &multiplex_icon },
    .{ .name = "stop", .icon = &stop_icon },
};

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
const gx_command_cache_capacity: usize = 1024;
var gx_command_cache: [gx_command_cache_capacity]GxCommand = undefined;
var gx_command_cache_count: u32 = 0;
var gx_command_cache_valid = false;
var app_model: *const core.Model = undefined;
var app_initialized = false;
var staged_gateway_name: []const u8 = &.{};
var staged_rows: [3]core.CatalogRow = undefined;
var staged_row_ptrs: [3]*const core.CatalogRow = undefined;
var staged_items: [12]core.CatalogItem = undefined;
var staged_item_ptrs: [12]*const core.CatalogItem = undefined;
var staged_row_count: usize = 0;
var staged_libraries: [8]core.LibrarySection = undefined;
var staged_library_ptrs: [8]*const core.LibrarySection = undefined;
var staged_library_count: usize = 0;
var staged_browse_title: []const u8 = &.{};
var staged_browse_section_id: u32 = 0;
var staged_browse_start: u32 = 0;
var staged_browse_total: u32 = 0;
var staged_browse_items: []core.CatalogItem = &.{};
var staged_browse_item_ptrs: []*const core.CatalogItem = &.{};
var staged_browse_item_count: usize = 0;
var staged_watch_together_rooms: [4]core.WatchTogetherRoom = undefined;
var staged_watch_together_room_ptrs: [4]*const core.WatchTogetherRoom = undefined;
var staged_watch_together_titles: [4][96]u8 = undefined;
var staged_watch_together_room_count: usize = 0;
var staged_watch_together_available = false;
var staged_watch_together_invitees: [8]core.WatchTogetherInvitee = undefined;
var staged_watch_together_invitee_ptrs: [8]*const core.WatchTogetherInvitee = undefined;
var staged_watch_together_invitee_names: [8][64]u8 = undefined;
var staged_watch_together_invitee_count: usize = 0;
var staged_watch_together_invitees_available = false;
var staged_subtitle_streams: [4]core.SubtitleStream = undefined;
var staged_subtitle_stream_ptrs: [4]*const core.SubtitleStream = undefined;
var staged_subtitle_labels: [4][64]u8 = undefined;
var details_title_buffer: [96]u8 = undefined;
var details_secondary_buffer: [96]u8 = undefined;
var details_hierarchy_buffer: [48]u8 = undefined;
var details_type_buffer: [32]u8 = undefined;
var details_library_buffer: [96]u8 = undefined;
var details_content_rating_buffer: [32]u8 = undefined;
var details_facts_buffer: [128]u8 = undefined;
var details_summary_buffer: [384]u8 = undefined;
var details_genres_buffer: [128]u8 = undefined;
var details_directors_buffer: [128]u8 = undefined;
const invalid_focused_handler = std.math.maxInt(usize);
const ReferenceDirtyRegion = enum {
    none,
    search_input,
};
var focused_handler: usize = invalid_focused_handler;
var focused_screen: core.Screen = .pairing;
var reference_render_stage: u32 = 0;
var reference_full_repaint = true;
var reference_dirty_region: ReferenceDirtyRegion = .none;
var reference_dirty_bounds: ?geometry.RectF = null;
var reference_last_full_repaint = true;
var previous_render_state: canvas.WidgetRenderState = .{};
var previous_render_state_valid = false;
var reference_memo_allocator: BoundedMemoAllocator = .{};
var reference_render_memo: canvas.ReferenceRenderMemo = undefined;
var reference_render_memo_initialized = false;
var video_surface: VideoSurface = .{};
var player_controls_surface: PlayerControlsSurface = .{};
var modal_surface: ModalSurface = .{};
var poster_surfaces: [4]PosterSurface = [_]PosterSurface{.{}} ** 4;
var poster_card_ids: [4]canvas.ObjectId = [_]canvas.ObjectId{0} ** 4;
var poster_surface_count: u32 = 0;
var reference_text_overlay_enabled = false;

extern fn multiplex_native_profile_mark(stage: u32) callconv(.c) void;
extern fn multiplex_native_input_trace(action: u32, focus: u32, count: u32, message: u32) callconv(.c) void;
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

pub const VideoSurface = extern struct {
    visible: u32 = 0,
    playing: u32 = 0,
    x: f32 = 0,
    y: f32 = 0,
    width: f32 = 0,
    height: f32 = 0,
};

pub const PlayerControlsSurface = extern struct {
    visible: u32 = 0,
    x: f32 = 0,
    y: f32 = 0,
    width: f32 = 0,
    height: f32 = 0,
};

pub const ModalSurface = extern struct {
    visible: u32 = 0,
    x: f32 = 0,
    y: f32 = 0,
    width: f32 = 0,
    height: f32 = 0,
};

pub const PosterSurface = extern struct {
    image_id: u32 = 0,
    x: f32 = 0,
    y: f32 = 0,
    width: f32 = 0,
    height: f32 = 0,
    radius: f32 = 0,
};

const gx_fill_rect: u32 = 1;
const gx_fill_rounded_rect: u32 = 2;
const gx_stroke_rect: u32 = 3;
const gx_line: u32 = 4;
const gx_text: u32 = 5;
const gx_shadow: u32 = 6;
const gx_glyph: u32 = 7;
const gx_path_line: u32 = 8;
const gx_fill_triangle: u32 = 9;

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
    const next = core.update(connected, .next_row);
    return next.rowIndex;
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
    canvas.icons.registerAppIcons(&app_icons);
    core.rt.resetAll();
    app_model = core.commitModelRoot(core.initialModel());
    core.rt.frameReset();
    app_initialized = true;
    focused_handler = invalid_focused_handler;
    focused_screen = .pairing;
    reference_full_repaint = true;
    reference_dirty_region = .none;
    previous_render_state = .{};
    previous_render_state_valid = false;
    video_surface = .{};
    player_controls_surface = .{};
    modal_surface = .{};
    poster_surfaces = [_]PosterSurface{.{}} ** 4;
    poster_card_ids = [_]canvas.ObjectId{0} ** 4;
    poster_surface_count = 0;
}

fn commitAppModel(next: *const core.Model) void {
    app_model = core.commitModelRoot(next);
    core.rt.frameReset();
}

fn stageBytes(bytes: []const u8) []const u8 {
    if (bytes.len == 0) return &.{};
    const staged = core.rt.frameAlloc(u8, bytes.len);
    @memcpy(staged, bytes);
    return staged;
}

fn beginStagedBrowseItems(item_count: usize) void {
    staged_browse_items = core.rt.frameAlloc(core.CatalogItem, item_count);
    staged_browse_item_ptrs = core.rt.frameAlloc(*const core.CatalogItem, item_count);
    staged_browse_item_count = item_count;
}

fn prefersFocus(model: *const core.Model, msg: core.Msg) bool {
    if (model.playerSettingsOpen) {
        return switch (msg) {
            .cycle_subtitles, .close_player_settings => true,
            else => false,
        };
    }
    if (model.startMenuOpen) {
        return switch (msg) {
            .start_menu_play, .start_menu_mark_watched, .start_menu_create_watch_together, .start_menu_watch_together => true,
            else => false,
        };
    }
    return switch (model.screen) {
        .home, .browse, .search_results => switch (msg) {
            .open_item => true,
            else => false,
        },
        .libraries => switch (msg) {
            .open_library => true,
            else => false,
        },
        .search => switch (msg) {
            .search_key => true,
            else => false,
        },
        .details => switch (msg) {
            .play => true,
            else => false,
        },
        .player => switch (msg) {
            .toggle_playback => true,
            else => false,
        },
        else => false,
    };
}

fn receivesFocus(model: *const core.Model, msg: core.Msg) bool {
    if (model.playerSettingsOpen) {
        return switch (msg) {
            .cycle_subtitles, .close_player_settings => true,
            else => false,
        };
    }
    if (model.startMenuOpen) {
        return switch (msg) {
            .start_menu_play,
            .start_menu_mark_watched,
            .start_menu_create_watch_together,
            .start_menu_watch_together,
            .start_menu_libraries,
            .start_menu_search,
            .close_start_menu,
            => true,
            else => false,
        };
    }
    return true;
}

fn resolveFocusedHandler(tree: anytype, press_ids: []const canvas.ObjectId, model: *const core.Model) void {
    if (focused_screen != model.screen) {
        focused_screen = model.screen;
        focused_handler = invalid_focused_handler;
    }
    if (focused_handler < press_ids.len) return;
    focused_handler = 0;
    for (press_ids, 0..) |id, index| {
        const msg = tree.msgFor(id, .press) orelse continue;
        if (!prefersFocus(model, msg)) continue;
        focused_handler = index;
        return;
    }
}

fn collectEnabledPressIds(tree: anytype, press_ids: []canvas.ObjectId, model: *const core.Model) usize {
    var press_count: usize = 0;
    for (tree.handlers) |handler| {
        const msg = tree.msgFor(handler.id, .press) orelse continue;
        if (!receivesFocus(model, msg)) continue;
        const widget = tree.findWidget(handler.id) orelse continue;
        if (widget.state.disabled) continue;
        var duplicate = false;
        for (press_ids[0..press_count]) |id| {
            if (id == handler.id) duplicate = true;
        }
        if (!duplicate and press_count < press_ids.len) {
            press_ids[press_count] = handler.id;
            press_count += 1;
        }
    }
    return press_count;
}

fn focusFrame(nodes: []const canvas.WidgetLayoutNode, id: canvas.ObjectId) ?geometry.RectF {
    for (nodes) |node| {
        if (node.widget.id == id) return node.frame.normalized();
    }
    return null;
}

fn moveFocusSpatial(
    press_ids: []const canvas.ObjectId,
    nodes: []const canvas.WidgetLayoutNode,
    horizontal: f32,
    vertical: f32,
) bool {
    if (focused_handler >= press_ids.len) return false;
    const current = focusFrame(nodes, press_ids[focused_handler]) orelse return false;
    const current_x = current.x + current.width * 0.5;
    const current_y = current.y + current.height * 0.5;
    var best_index: ?usize = null;
    var best_score: f32 = std.math.floatMax(f32);
    for (press_ids, 0..) |id, index| {
        if (index == focused_handler) continue;
        const candidate = focusFrame(nodes, id) orelse continue;
        const delta_x = candidate.x + candidate.width * 0.5 - current_x;
        const delta_y = candidate.y + candidate.height * 0.5 - current_y;
        const primary = delta_x * horizontal + delta_y * vertical;
        if (primary <= 1.0) continue;
        const secondary = @abs(delta_x * vertical - delta_y * horizontal);
        const score = primary + secondary * 2.5;
        if (score < best_score) {
            best_score = score;
            best_index = index;
        }
    }
    if (best_index) |index| {
        focused_handler = index;
        return true;
    }
    return false;
}

export fn multiplex_native_app_init() callconv(.c) void {
    initializeApp();
}

export fn multiplex_native_app_pairing_status(
    status: u32,
    code: [*]const u8,
    code_length: u32,
    link_url: [*]const u8,
    link_url_length: u32,
) callconv(.c) u32 {
    if (!app_initialized or status < 1 or status > 4) return 0;
    if (status == 1 and (code_length != 4 or link_url_length == 0)) return 0;
    commitAppModel(core.loadPairing(
        app_model,
        @floatFromInt(status),
        code[0..code_length],
        link_url[0..link_url_length],
    ));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_catalog_begin(
    server_name: [*]const u8,
    server_name_length: u32,
    row_count: u32,
    library_count: u32,
) callconv(.c) u32 {
    if (!app_initialized or server_name_length == 0 or row_count == 0 or row_count > 3 or library_count > 8) return 0;
    staged_gateway_name = server_name[0..server_name_length];
    staged_row_count = row_count;
    staged_library_count = library_count;
    return 1;
}

fn libraryTypeLabel(media_type: u32) []const u8 {
    return switch (media_type) {
        1 => "Movies",
        2 => "TV Shows",
        3 => "Music",
        4 => "Photos",
        else => "Library",
    };
}

export fn multiplex_native_app_catalog_library(
    index: u32,
    section_id: u32,
    media_type: u32,
    title: [*]const u8,
    title_length: u32,
) callconv(.c) u32 {
    if (index >= staged_library_count or section_id == 0 or title_length == 0) return 0;
    const slot: usize = index;
    staged_libraries[slot] = .{
        .id = @intCast(index),
        .sectionId = @floatFromInt(section_id),
        .title = title[0..title_length],
        .mediaType = @intCast(media_type),
        .typeLabel = libraryTypeLabel(media_type),
    };
    staged_library_ptrs[slot] = &staged_libraries[slot];
    return 1;
}

export fn multiplex_native_app_catalog_row(
    row_index: u32,
    title: [*]const u8,
    title_length: u32,
    item_count: u32,
) callconv(.c) u32 {
    if (row_index >= staged_row_count or title_length == 0 or item_count == 0 or item_count > 4) return 0;
    const row: usize = row_index;
    const offset = row * 4;
    staged_rows[row] = .{
        .id = @intCast(row_index),
        .title = title[0..title_length],
        .items = staged_item_ptrs[offset .. offset + item_count],
    };
    staged_row_ptrs[row] = &staged_rows[row];
    return 1;
}

export fn multiplex_native_app_catalog_item(
    row_index: u32,
    item_index: u32,
    rating_key: u32,
    title: [*]const u8,
    title_length: u32,
    subtitle: [*]const u8,
    subtitle_length: u32,
    artwork_slot: u32,
    duration_ms: u32,
    view_offset_ms: u32,
    progress_percent: u32,
) callconv(.c) u32 {
    if (row_index >= staged_row_count or item_index >= 4 or title_length == 0) return 0;
    const flat: usize = @as(usize, row_index) * 4 + item_index;
    staged_items[flat] = .{
        .id = @intCast(item_index),
        .ratingKey = @intCast(rating_key),
        .title = title[0..title_length],
        .subtitle = subtitle[0..subtitle_length],
        .imageId = @intCast(artwork_slot + 1),
        .durationMs = @intCast(duration_ms),
        .viewOffsetMs = @intCast(view_offset_ms),
        .progressPercent = @intCast(progress_percent),
    };
    staged_item_ptrs[flat] = &staged_items[flat];
    return 1;
}

export fn multiplex_native_app_catalog_commit() callconv(.c) u32 {
    if (!app_initialized or staged_row_count == 0) return 0;
    commitAppModel(core.loadCatalog(
        app_model,
        staged_gateway_name,
        staged_row_ptrs[0..staged_row_count],
        staged_library_ptrs[0..staged_library_count],
    ));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_begin(
    available: u32,
    room_count: u32,
) callconv(.c) u32 {
    if (!app_initialized or room_count > staged_watch_together_rooms.len) return 0;
    staged_watch_together_available = available != 0;
    staged_watch_together_room_count = room_count;
    return 1;
}

export fn multiplex_native_app_watch_together_room(
    index: u32,
    title: [*]const u8,
    title_length: u32,
    participant_count: u32,
) callconv(.c) u32 {
    if (index >= staged_watch_together_room_count or title_length == 0 or title_length >= staged_watch_together_titles[0].len) return 0;
    const slot: usize = index;
    @memcpy(staged_watch_together_titles[slot][0..title_length], title[0..title_length]);
    staged_watch_together_rooms[slot] = .{
        .id = @intCast(index),
        .title = staged_watch_together_titles[slot][0..title_length],
        .participantCount = @intCast(participant_count),
    };
    staged_watch_together_room_ptrs[slot] = &staged_watch_together_rooms[slot];
    return 1;
}

export fn multiplex_native_app_watch_together_commit() callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.loadWatchTogetherRooms(
        app_model,
        staged_watch_together_available,
        staged_watch_together_room_ptrs[0..staged_watch_together_room_count],
    ));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_invitees_begin(
    available: u32,
    invitee_count: u32,
) callconv(.c) u32 {
    if (!app_initialized or invitee_count > staged_watch_together_invitees.len) return 0;
    staged_watch_together_invitees_available = available != 0;
    staged_watch_together_invitee_count = invitee_count;
    return 1;
}

export fn multiplex_native_app_watch_together_invitee(
    index: u32,
    user_id: u32,
    name: [*]const u8,
    name_length: u32,
) callconv(.c) u32 {
    if (index >= staged_watch_together_invitee_count or user_id == 0 or
        name_length == 0 or name_length >= staged_watch_together_invitee_names[0].len) return 0;
    const slot: usize = index;
    @memcpy(staged_watch_together_invitee_names[slot][0..name_length], name[0..name_length]);
    staged_watch_together_invitees[slot] = .{
        .id = @intCast(index),
        .userId = @intCast(user_id),
        .title = staged_watch_together_invitee_names[slot][0..name_length],
    };
    staged_watch_together_invitee_ptrs[slot] = &staged_watch_together_invitees[slot];
    return 1;
}

export fn multiplex_native_app_watch_together_invitees_commit() callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.loadWatchTogetherInvitees(
        app_model,
        staged_watch_together_invitees_available,
        staged_watch_together_invitee_ptrs[0..staged_watch_together_invitee_count],
    ));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_create_request(
    rating_key: *u32,
    invitee_user_id: *u32,
    title: [*]u8,
    title_capacity: u32,
) callconv(.c) u32 {
    if (!app_initialized) return 0;
    const requested_rating_key = core.watchTogetherCreateRatingKey(app_model);
    const requested_invitee_user_id = core.watchTogetherCreateInviteeId(app_model);
    const requested_title = core.watchTogetherCreateTitle(app_model);
    if (requested_rating_key <= 0 or requested_rating_key > std.math.maxInt(u32) or
        requested_invitee_user_id <= 0 or requested_invitee_user_id > std.math.maxInt(u32) or
        requested_title.len == 0 or requested_title.len >= title_capacity) return 0;
    rating_key.* = @intCast(requested_rating_key);
    invitee_user_id.* = @intCast(requested_invitee_user_id);
    @memcpy(title[0..requested_title.len], requested_title);
    title[requested_title.len] = 0;
    return @intCast(requested_title.len);
}

export fn multiplex_native_app_watch_together_create_fail() callconv(.c) u32 {
    if (!app_initialized or core.watchTogetherCreateRatingKey(app_model) == 0) return 0;
    commitAppModel(core.failWatchTogetherCreate(app_model));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_join_request() callconv(.c) u32 {
    if (!app_initialized) return 0;
    const requested = core.watchTogetherJoinRequestIndex(app_model);
    if (requested <= 0 or requested > std.math.maxInt(u32)) return 0;
    return @intCast(requested);
}

export fn multiplex_native_app_watch_together_join_commit(connected: u32) callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.completeWatchTogetherJoin(app_model, connected != 0));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_presence(
    connected: u32,
    participant_count: u32,
) callconv(.c) u32 {
    if (!app_initialized) return 0;
    const is_connected = connected != 0;
    const normalized_count: f64 = if (is_connected) @floatFromInt(@max(participant_count, 1)) else 0;
    if (app_model.watchTogetherConnected == is_connected and
        app_model.watchTogetherPresentCount == normalized_count) return 1;
    const next = core.updateWatchTogetherPresence(
        app_model,
        is_connected,
        @floatFromInt(participant_count),
    );
    commitAppModel(next);
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_leave_request() callconv(.c) u32 {
    if (!app_initialized) return 0;
    return @intFromBool(app_model.watchTogetherLeaveRequested);
}

export fn multiplex_native_app_watch_together_leave_commit() callconv(.c) u32 {
    if (!app_initialized or !app_model.watchTogetherLeaveRequested) return 0;
    commitAppModel(core.completeWatchTogetherLeave(app_model));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_reconnect_request() callconv(.c) u32 {
    if (!app_initialized) return 0;
    return @intFromBool(app_model.watchTogetherReconnectRequested);
}

export fn multiplex_native_app_watch_together_reconnect_commit() callconv(.c) u32 {
    if (!app_initialized or !app_model.watchTogetherReconnectRequested) return 0;
    commitAppModel(core.completeWatchTogetherReconnect(app_model));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_host(host: u32) callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.setWatchTogetherHost(app_model, host != 0));
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_disband_request() callconv(.c) u32 {
    if (!app_initialized) return 0;
    return @intFromBool(app_model.watchTogetherDisbandRequested);
}

export fn multiplex_native_app_watch_together_disband_commit(deleted: u32) callconv(.c) u32 {
    if (!app_initialized or !app_model.watchTogetherDisbandRequested) return 0;
    commitAppModel(core.completeWatchTogetherDisband(app_model, deleted != 0));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_watch_together_playback(
    room_index: u32,
    rating_key: u32,
    title: [*]const u8,
    title_length: u32,
    duration_ms: u32,
    offset_ms: u32,
) callconv(.c) u32 {
    if (!app_initialized or room_index >= app_model.watchTogetherRooms.len or rating_key == 0 or duration_ms == 0) return 0;
    const stored_title = copyDetailsString(&details_title_buffer, title, title_length) orelse return 0;
    const next = core.rt.frameCreate(core.Model, app_model.*);
    next.screen = .player;
    next.selectedWatchTogetherRoomIndex = @intCast(room_index);
    next.selectedRatingKey = @intCast(rating_key);
    next.selectedTitle = stored_title;
    next.selectedDurationMs = @intCast(duration_ms);
    next.selectedViewOffsetMs = @intCast(offset_ms);
    next.selectedFromBrowse = false;
    next.selectedFromSearch = false;
    next.playbackOffsetMs = @intCast(offset_ms);
    next.playbackLoaded = true;
    next.playing = true;
    next.watchTogetherActive = true;
    next.watchTogetherLeaveRequested = false;
    next.watchTogetherReconnectRequested = false;
    next.watchTogetherDisbandRequested = false;
    commitAppModel(next);
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_playback_state() callconv(.c) u32 {
    if (!app_initialized) return 0;
    return @as(u32, @intFromBool(app_model.screen == .player)) |
        (@as(u32, @intFromBool(app_model.playbackLoaded)) << 1) |
        (@as(u32, @intFromBool(app_model.playing)) << 2);
}

export fn multiplex_native_app_screen() callconv(.c) u32 {
    if (!app_initialized) return 0;
    return switch (app_model.screen) {
        .pairing => 0,
        .home => 1,
        .libraries => 2,
        .browse => 3,
        .search => 4,
        .search_results => 5,
        .watch_together_invite => 6,
        .watch_together => 7,
        .watch_together_room => 8,
        .details => 9,
        .player => 10,
    };
}

export fn multiplex_native_app_playback_set_paused(paused: u32) callconv(.c) u32 {
    if (!app_initialized or app_model.screen != .player or !app_model.playbackLoaded) return 0;
    const playing = paused == 0;
    if (app_model.playing == playing) return 1;
    const next = core.rt.frameCreate(core.Model, app_model.*);
    next.playing = playing;
    commitAppModel(next);
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_browse_request(section_id: *u32, start: *u32) callconv(.c) u32 {
    const requested = core.browseRequestSection(app_model);
    if (requested == 0) return 0;
    section_id.* = @intFromFloat(requested);
    start.* = @intFromFloat(core.browseRequestStart(app_model));
    return 1;
}

export fn multiplex_native_app_browse_begin(
    section_id: u32,
    title: [*]const u8,
    title_length: u32,
    start: u32,
    total: u32,
    item_count: u32,
) callconv(.c) u32 {
    if (!app_initialized or section_id == 0 or title_length == 0 or item_count == 0 or item_count > 4) return 0;
    staged_browse_section_id = section_id;
    staged_browse_title = stageBytes(title[0..title_length]);
    staged_browse_start = start;
    staged_browse_total = total;
    beginStagedBrowseItems(@intCast(item_count));
    return 1;
}

export fn multiplex_native_app_browse_item(
    item_index: u32,
    rating_key: u32,
    title: [*]const u8,
    title_length: u32,
    subtitle: [*]const u8,
    subtitle_length: u32,
    artwork_slot: u32,
    duration_ms: u32,
    view_offset_ms: u32,
    progress_percent: u32,
) callconv(.c) u32 {
    if (item_index >= staged_browse_item_count or title_length == 0 or artwork_slot >= 4) return 0;
    const slot: usize = item_index;
    staged_browse_items[slot] = .{
        .id = @intCast(item_index),
        .ratingKey = @intCast(rating_key),
        .title = stageBytes(title[0..title_length]),
        .subtitle = stageBytes(subtitle[0..subtitle_length]),
        .imageId = @intCast(13 + artwork_slot),
        .durationMs = @intCast(duration_ms),
        .viewOffsetMs = @intCast(view_offset_ms),
        .progressPercent = @intCast(progress_percent),
    };
    staged_browse_item_ptrs[slot] = &staged_browse_items[slot];
    return 1;
}

export fn multiplex_native_app_browse_commit() callconv(.c) u32 {
    if (!app_initialized or staged_browse_item_count == 0) return 0;
    commitAppModel(core.loadBrowse(
        app_model,
        @as(f64, @floatFromInt(staged_browse_section_id)),
        staged_browse_title,
        @as(f64, @floatFromInt(staged_browse_start)),
        staged_browse_total,
        staged_browse_start / 4 + 1,
        if (staged_browse_total == 0) 1 else (staged_browse_total - 1) / 4 + 1,
        staged_browse_item_ptrs[0..staged_browse_item_count],
    ));
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_search_request(output: [*]u8, capacity: u32) callconv(.c) u32 {
    const query = core.searchRequestQuery(app_model);
    if (query.len == 0 or query.len > capacity) return 0;
    @memcpy(output[0..query.len], query);
    return @intCast(query.len);
}

export fn multiplex_native_app_search_begin(
    query: [*]const u8,
    query_length: u32,
    item_count: u32,
) callconv(.c) u32 {
    if (!app_initialized or query_length == 0 or item_count > 4) return 0;
    staged_browse_title = stageBytes(query[0..query_length]);
    beginStagedBrowseItems(@intCast(item_count));
    return 1;
}

export fn multiplex_native_app_search_item(
    item_index: u32,
    rating_key: u32,
    title: [*]const u8,
    title_length: u32,
    subtitle: [*]const u8,
    subtitle_length: u32,
    artwork_slot: u32,
    duration_ms: u32,
    view_offset_ms: u32,
    progress_percent: u32,
) callconv(.c) u32 {
    return multiplex_native_app_browse_item(
        item_index,
        rating_key,
        title,
        title_length,
        subtitle,
        subtitle_length,
        artwork_slot,
        duration_ms,
        view_offset_ms,
        progress_percent,
    );
}

export fn multiplex_native_app_search_commit() callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.loadSearch(
        app_model,
        staged_browse_title,
        staged_browse_item_ptrs[0..staged_browse_item_count],
    ));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_details_request() callconv(.c) u32 {
    if (!app_initialized) return 0;
    const rating_key = core.detailsRequestRatingKey(app_model);
    if (rating_key <= 0 or rating_key > std.math.maxInt(u32)) return 0;
    return @intCast(rating_key);
}

export fn multiplex_native_app_details_children_request(
    rating_key: *u32,
    start: *u32,
) callconv(.c) u32 {
    if (!app_initialized) return 0;
    const requested = core.detailsChildrenRequestRatingKey(app_model);
    if (requested <= 0 or requested > std.math.maxInt(u32)) return 0;
    rating_key.* = @intCast(requested);
    start.* = @intFromFloat(core.detailsChildrenRequestStart(app_model));
    return 1;
}

export fn multiplex_native_app_details_children_begin(
    rating_key: u32,
    start: u32,
    total: u32,
    item_count: u32,
) callconv(.c) u32 {
    if (!app_initialized or rating_key == 0 or item_count > 4) return 0;
    staged_browse_section_id = rating_key;
    staged_browse_start = start;
    staged_browse_total = total;
    beginStagedBrowseItems(@intCast(item_count));
    return 1;
}

export fn multiplex_native_app_details_child(
    item_index: u32,
    rating_key: u32,
    title: [*]const u8,
    title_length: u32,
    subtitle: [*]const u8,
    subtitle_length: u32,
    artwork_slot: u32,
    duration_ms: u32,
    view_offset_ms: u32,
    progress_percent: u32,
) callconv(.c) u32 {
    return multiplex_native_app_browse_item(
        item_index,
        rating_key,
        title,
        title_length,
        subtitle,
        subtitle_length,
        artwork_slot,
        duration_ms,
        view_offset_ms,
        progress_percent,
    );
}

export fn multiplex_native_app_details_children_commit() callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.loadDetailsChildren(
        app_model,
        @as(f64, @floatFromInt(staged_browse_section_id)),
        @as(f64, @floatFromInt(staged_browse_start)),
        staged_browse_total,
        staged_browse_start / 4 + 1,
        if (staged_browse_total == 0) 1 else (staged_browse_total - 1) / 4 + 1,
        staged_browse_item_ptrs[0..staged_browse_item_count],
    ));
    reference_full_repaint = true;
    return 1;
}

fn copyDetailsString(destination: []u8, source: [*]const u8, length: u32) ?[]const u8 {
    if (length >= destination.len) return null;
    @memcpy(destination[0..length], source[0..length]);
    return destination[0..length];
}

export fn multiplex_native_app_details_commit(
    title: [*]const u8,
    title_length: u32,
    secondary: [*]const u8,
    secondary_length: u32,
    hierarchy: [*]const u8,
    hierarchy_length: u32,
    media_type: [*]const u8,
    media_type_length: u32,
    library: [*]const u8,
    library_length: u32,
    content_rating: [*]const u8,
    content_rating_length: u32,
    facts: [*]const u8,
    facts_length: u32,
    summary: [*]const u8,
    summary_length: u32,
    genres: [*]const u8,
    genres_length: u32,
    directors: [*]const u8,
    directors_length: u32,
    playable: u32,
) callconv(.c) u32 {
    if (!app_initialized or title_length == 0) return 0;
    const stored_title = copyDetailsString(&details_title_buffer, title, title_length) orelse return 0;
    const stored_secondary = copyDetailsString(&details_secondary_buffer, secondary, secondary_length) orelse return 0;
    const stored_hierarchy = copyDetailsString(&details_hierarchy_buffer, hierarchy, hierarchy_length) orelse return 0;
    const stored_media_type = copyDetailsString(&details_type_buffer, media_type, media_type_length) orelse return 0;
    const stored_library = copyDetailsString(&details_library_buffer, library, library_length) orelse return 0;
    const stored_content_rating = copyDetailsString(&details_content_rating_buffer, content_rating, content_rating_length) orelse return 0;
    const stored_facts = copyDetailsString(&details_facts_buffer, facts, facts_length) orelse return 0;
    const stored_summary = copyDetailsString(&details_summary_buffer, summary, summary_length) orelse return 0;
    const stored_genres = copyDetailsString(&details_genres_buffer, genres, genres_length) orelse return 0;
    const stored_directors = copyDetailsString(&details_directors_buffer, directors, directors_length) orelse return 0;
    commitAppModel(core.loadDetails(
        app_model,
        stored_title,
        stored_secondary,
        stored_hierarchy,
        stored_media_type,
        stored_library,
        stored_content_rating,
        stored_facts,
        stored_summary,
        stored_genres,
        stored_directors,
        playable != 0,
    ));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_details_fail() callconv(.c) u32 {
    if (!app_initialized or core.detailsRequestRatingKey(app_model) == 0) return 0;
    commitAppModel(core.failDetails(app_model));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_subtitles(
    count: u32,
    selected: u32,
    labels: [*]const u8,
    label_stride: u32,
    label_lengths: [*]const u8,
) callconv(.c) u32 {
    if (!app_initialized or count > 4 or selected > count or label_stride == 0 or label_stride > 64) return 0;
    for (0..count) |index| {
        const label_length = label_lengths[index];
        if (label_length == 0 or label_length >= 64 or label_length >= label_stride) return 0;
        @memcpy(staged_subtitle_labels[index][0..label_length], labels[index * label_stride ..][0..label_length]);
        staged_subtitle_streams[index] = .{
            .id = @intCast(index),
            .label = staged_subtitle_labels[index][0..label_length],
        };
        staged_subtitle_stream_ptrs[index] = &staged_subtitle_streams[index];
    }
    commitAppModel(core.loadSubtitleStreams(
        app_model,
        staged_subtitle_stream_ptrs[0..count],
        @intCast(selected),
    ));
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_subtitle_selection() callconv(.c) u32 {
    if (!app_initialized) return 0;
    const selected = core.playbackSubtitleSelection(app_model);
    if (selected < 0 or selected > 4) return 0;
    return @intCast(selected);
}

export fn multiplex_native_app_mark_watched_request() callconv(.c) u32 {
    if (!app_initialized) return 0;
    return @intCast(core.markWatchedRequestRatingKey(app_model));
}

export fn multiplex_native_app_mark_watched_commit(succeeded: u32) callconv(.c) u32 {
    if (!app_initialized or !app_model.markWatchedRequested) return 0;
    commitAppModel(core.completeMarkWatched(app_model, succeeded != 0));
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_toast_dismiss() callconv(.c) u32 {
    if (!app_initialized or !app_model.toastVisible) return 0;
    commitAppModel(core.dismissToast(app_model));
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_player_settings_open() callconv(.c) u32 {
    return if (app_initialized and app_model.playerSettingsOpen) 1 else 0;
}

export fn multiplex_native_app_playback_navigation_request() callconv(.c) i32 {
    if (!app_initialized) return 0;
    return @intCast(core.playbackRequestedNavigation(app_model));
}

export fn multiplex_native_app_playback_navigation_clear() callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.clearPlaybackNavigationRequest(app_model));
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_playback_navigate(
    rating_key: u32,
    title: [*]const u8,
    title_length: u32,
    secondary: [*]const u8,
    secondary_length: u32,
    hierarchy: [*]const u8,
    hierarchy_length: u32,
    duration_ms: u32,
) callconv(.c) u32 {
    if (!app_initialized or app_model.screen != .player or !app_model.playbackLoaded or rating_key == 0 or title_length == 0 or duration_ms <= 1) return 0;
    const stored_title = copyDetailsString(&details_title_buffer, title, title_length) orelse return 0;
    const stored_secondary = copyDetailsString(&details_secondary_buffer, secondary, secondary_length) orelse return 0;
    const stored_hierarchy = copyDetailsString(&details_hierarchy_buffer, hierarchy, hierarchy_length) orelse return 0;
    const next = core.rt.frameCreate(core.Model, app_model.*);
    next.selectedRatingKey = @intCast(rating_key);
    next.selectedTitle = stored_title;
    next.selectedDurationMs = @intCast(duration_ms);
    next.selectedViewOffsetMs = 0;
    next.playbackOffsetMs = 0;
    next.playbackLoaded = false;
    next.playing = false;
    next.playbackNavigationRequest = 0;
    next.detailsLoaded = false;
    next.detailsSecondary = stored_secondary;
    next.detailsHierarchy = stored_hierarchy;
    next.detailsChildren = &.{};
    next.detailsChildrenStart = 0;
    next.detailsChildrenPageNumber = 1;
    next.detailsChildrenPageCount = 1;
    next.detailsChildrenTotal = 0;
    next.detailsChildrenLoaded = false;
    commitAppModel(next);
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_playback_request() callconv(.c) u32 {
    if (!app_initialized) return 0;
    const rating_key = core.playbackRequestRatingKey(app_model);
    if (rating_key <= 0 or rating_key > std.math.maxInt(u32)) return 0;
    return @intCast(rating_key);
}

export fn multiplex_native_app_playback_offset_request() callconv(.c) u32 {
    if (!app_initialized) return 0;
    const offset_ms = core.playbackRequestOffsetMs(app_model);
    if (offset_ms < 0 or offset_ms > std.math.maxInt(u32)) return 0;
    return @intCast(offset_ms);
}

export fn multiplex_native_app_playback_commit() callconv(.c) u32 {
    if (!app_initialized or core.playbackRequestRatingKey(app_model) == 0) return 0;
    commitAppModel(core.loadPlayback(app_model));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_playback_advance(
    rating_key: u32,
    title: [*]const u8,
    title_length: u32,
    duration_ms: u32,
) callconv(.c) u32 {
    if (!app_initialized or app_model.screen != .player or !app_model.playbackLoaded or rating_key == 0 or duration_ms <= 1) return 0;
    const stored_title = copyDetailsString(&details_title_buffer, title, title_length) orelse return 0;
    const completed = core.update(app_model, .complete_playback);
    const next = core.rt.frameCreate(core.Model, completed.*);
    next.selectedRatingKey = @intCast(rating_key);
    next.selectedTitle = stored_title;
    next.selectedDurationMs = @intCast(duration_ms);
    next.selectedViewOffsetMs = 0;
    next.playbackOffsetMs = 0;
    next.playbackLoaded = false;
    next.playing = false;
    next.playbackNavigationRequest = 0;
    next.detailsLoaded = false;
    next.detailsChildren = &.{};
    next.detailsChildrenStart = 0;
    next.detailsChildrenPageNumber = 1;
    next.detailsChildrenPageCount = 1;
    next.detailsChildrenTotal = 0;
    next.detailsChildrenLoaded = false;
    commitAppModel(next);
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_playback_fail() callconv(.c) u32 {
    if (!app_initialized or core.playbackRequestRatingKey(app_model) == 0) return 0;
    commitAppModel(core.failPlayback(app_model));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_playback_position(position_ms: u32) callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.update(app_model, .{ .sync_playback = @intCast(position_ms) }));
    return 1;
}

export fn multiplex_native_app_playback_continue(position_ms: u32) callconv(.c) u32 {
    if (!app_initialized) return 0;
    const continued = core.update(app_model, .{ .continue_playback = @intCast(position_ms) });
    if (core.playbackRequestRatingKey(continued) == 0) return 0;
    commitAppModel(continued);
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_playback_complete() callconv(.c) u32 {
    if (!app_initialized) return 0;
    commitAppModel(core.update(app_model, .complete_playback));
    focused_handler = invalid_focused_handler;
    reference_full_repaint = true;
    return 1;
}

export fn multiplex_native_app_layout_audit(first_rule: *u32, first_node: *u32) callconv(.c) u32 {
    first_rule.* = 0;
    first_node.* = 0;
    if (!app_initialized) return 0;
    const tokens = canvas.DesignTokens.theme(.{
        .pack = .geist,
        .color_scheme = .dark,
    });
    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const tree = ui.finalizeWithTokens(CompiledView.build(&ui, app_model), tokens) catch return std.math.maxInt(u32);
    const layout = canvas.layoutWidgetTreeWithTokens(
        tree.root,
        geometry.RectF.init(0, 0, 640, 480),
        tokens,
        &layout_nodes,
    ) catch return std.math.maxInt(u32);
    var storage: [canvas.max_layout_audit_findings]canvas.LayoutAuditFinding = undefined;
    const issues = canvas.auditWidgetLayout(
        layout,
        geometry.RectF.init(0, 0, 640, 480),
        tokens,
        &storage,
    );
    if (issues.findings.len > 0) {
        first_rule.* = @intFromEnum(issues.findings[0].rule) + 1;
        first_node.* = @intCast(issues.findings[0].node_index);
    }
    return @intCast(issues.total);
}

export fn multiplex_native_app_poster_inset_audit() callconv(.c) u32 {
    if (!app_initialized) return 0;
    const tokens = canvas.DesignTokens.theme(.{
        .pack = .geist,
        .color_scheme = .dark,
    });
    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const tree = ui.finalizeWithTokens(CompiledView.build(&ui, app_model), tokens) catch return std.math.maxInt(u32);
    const layout = canvas.layoutWidgetTreeWithTokens(
        tree.root,
        geometry.RectF.init(0, 0, 640, 480),
        tokens,
        &layout_nodes,
    ) catch return std.math.maxInt(u32);
    var issues: u32 = 0;
    for (layout.nodes) |node| {
        if (node.widget.kind != .image or node.frame.width < 100 or node.frame.width > 150) continue;
        var ancestor_index = node.parent_index;
        var panel_frame: ?geometry.RectF = null;
        while (ancestor_index) |index| {
            const ancestor = layout.nodes[index];
            if (ancestor.widget.kind == .panel) {
                panel_frame = ancestor.frame.normalized();
                break;
            }
            ancestor_index = ancestor.parent_index;
        }
        const panel = panel_frame orelse continue;
        const image = node.frame.normalized();
        const left_inset = image.x - panel.x;
        const right_inset = panel.x + panel.width - image.x - image.width;
        const top_inset = image.y - panel.y;
        if (left_inset > 0.75 or right_inset > 0.75 or top_inset > 0.75) issues += 1;
    }
    return issues;
}

/// 0/1 move focus backward/forward, 2 activates the focused `.native`
/// handler, and 3 dispatches the console Back message.
export fn multiplex_native_app_input(action: u32) callconv(.c) u32 {
    if (!app_initialized) return 0;
    const model = app_model;
    if (action == 4) {
        commitAppModel(core.update(model, .open_libraries));
        focused_handler = invalid_focused_handler;
        reference_full_repaint = true;
        multiplex_native_input_trace(action, 0, 0, 4);
        return 1;
    }
    if (action == 5) {
        const message: core.Msg = if (model.screen == .search) .search_delete else .next_row;
        commitAppModel(core.update(model, message));
        reference_full_repaint = model.screen != .search;
        reference_dirty_region = if (model.screen == .search) .search_input else .none;
        multiplex_native_input_trace(action, 0, 0, if (model.screen == .search) 15 else 3);
        return 1;
    }
    if (action == 12 or action == 13) {
        const message: core.Msg = if (action == 12) .search_cursor_left else .search_cursor_right;
        const next = core.update(model, message);
        if (next == model) return 0;
        commitAppModel(next);
        reference_full_repaint = false;
        reference_dirty_region = .search_input;
        multiplex_native_input_trace(action, 0, 0, if (action == 12) 46 else 47);
        return 1;
    }
    if (action == 6) {
        const message: core.Msg = if (model.screen == .search)
            .search_submit
        else if (model.screen == .player)
            .seek_forward
        else if (model.screen == .details)
            .details_children_next
        else
            .browse_next;
        commitAppModel(core.update(model, message));
        reference_full_repaint = true;
        multiplex_native_input_trace(action, 0, 0, if (model.screen == .search) 16 else if (model.screen == .player) 18 else if (model.screen == .details) 33 else 7);
        return 1;
    }
    if (action == 7) {
        if (model.screen == .search) return 0;
        const message: core.Msg = if (model.screen == .player)
            .seek_backward
        else if (model.screen == .details)
            .details_children_previous
        else
            .browse_previous;
        commitAppModel(core.update(model, message));
        reference_full_repaint = true;
        multiplex_native_input_trace(action, 0, 0, if (model.screen == .search) 15 else if (model.screen == .player) 17 else if (model.screen == .details) 32 else 6);
        return 1;
    }
    if (action == 10) {
        commitAppModel(core.update(model, .open_search));
        focused_handler = invalid_focused_handler;
        reference_full_repaint = true;
        multiplex_native_input_trace(action, 0, 0, 13);
        return 1;
    }
    if (action == 11) {
        const opened = core.update(model, .open_start_menu);
        if (!opened.startMenuOpen) return 0;
        commitAppModel(opened);
        focused_handler = invalid_focused_handler;
        reference_full_repaint = true;
        multiplex_native_input_trace(action, 0, 0, 35);
        return 1;
    }
    var fixed = std.heap.FixedBufferAllocator.init(&ui_arena);
    var ui = CompiledView.Ui.init(fixed.allocator());
    const tree = ui.finalizeWithTokens(CompiledView.build(&ui, model), .{}) catch return 0;

    var press_ids: [32]canvas.ObjectId = undefined;
    const press_count = collectEnabledPressIds(tree, &press_ids, model);
    if (action == 3) {
        commitAppModel(core.update(model, .back));
        focused_handler = invalid_focused_handler;
        reference_full_repaint = true;
        multiplex_native_input_trace(action, 0, @intCast(press_count), 12);
        return 1;
    }
    if (press_count == 0) return 0;
    resolveFocusedHandler(tree, press_ids[0..press_count], model);

    var message_kind: u32 = 0;
    var traced_focus = focused_handler;
    switch (action) {
        0, 1, 8, 9 => {
            const layout = canvas.layoutWidgetTreeWithTokens(
                tree.root,
                geometry.RectF.init(0, 0, reference_width, reference_height),
                canvas.DesignTokens.theme(.{ .pack = .geist, .color_scheme = .dark }),
                &layout_nodes,
            ) catch return 0;
            const horizontal: f32 = switch (action) {
                0 => -1,
                1 => 1,
                else => 0,
            };
            const vertical: f32 = switch (action) {
                8 => -1,
                9 => 1,
                else => 0,
            };
            if (!moveFocusSpatial(
                press_ids[0..press_count],
                layout.nodes,
                horizontal,
                vertical,
            )) return 0;
            reference_full_repaint = false;
        },
        2 => {
            traced_focus = focused_handler;
            const msg = tree.msgFor(press_ids[focused_handler], .press) orelse return 0;
            const keep_focus = switch (msg) {
                .search_key,
                .previous_row,
                .next_row,
                .browse_previous,
                .browse_next,
                .details_children_previous,
                .details_children_next,
                => true,
                else => false,
            };
            message_kind = switch (msg) {
                .connect_demo => 1,
                .previous_row => 2,
                .next_row => 3,
                .open_libraries => 4,
                .open_library => 5,
                .browse_previous => 6,
                .browse_next => 7,
                .open_search => 13,
                .open_watch_together => 22,
                .open_start_menu => 35,
                .close_start_menu => 36,
                .start_menu_play => 37,
                .start_menu_create_watch_together => 41,
                .start_menu_watch_together => 38,
                .start_menu_libraries => 39,
                .start_menu_search => 40,
                .create_watch_together => 23,
                .watch_together_invitees_previous => 24,
                .watch_together_invitees_next => 25,
                .invite_watch_together => 26,
                .join_watch_together => 27,
                .leave_watch_together => 28,
                .reconnect_watch_together => 29,
                .disband_watch_together => 30,
                .search_key => 14,
                .search_delete => 15,
                .search_cursor_left => 46,
                .search_cursor_right => 47,
                .search_submit => 16,
                .open_item => 8,
                .open_details_child => 31,
                .details_children_previous => 32,
                .details_children_next => 33,
                .play => 9,
                .mark_watched => 48,
                .seek_backward => 17,
                .seek_forward => 18,
                .open_player_settings => 41,
                .close_player_settings => 42,
                .stop_playback => 43,
                .play_previous => 44,
                .play_next => 45,
                .sync_playback => 19,
                .continue_playback => 20,
                .complete_playback => 21,
                .toggle_playback => 10,
                .cycle_subtitles => 34,
                .start_menu_mark_watched => 49,
                .back => 11,
            };
            commitAppModel(core.update(model, msg));
            if (!keep_focus) focused_handler = invalid_focused_handler;
            const search_input_changed = switch (msg) {
                .search_key, .search_delete, .search_cursor_left, .search_cursor_right => true,
                else => false,
            };
            reference_full_repaint = !search_input_changed;
            reference_dirty_region = if (search_input_changed) .search_input else .none;
        },
        else => return 0,
    }
    multiplex_native_input_trace(action, @intCast(traced_focus), @intCast(press_count), message_kind);
    return 1;
}

export fn multiplex_native_video_surface(output: *VideoSurface) callconv(.c) u32 {
    output.* = video_surface;
    return video_surface.visible;
}

export fn multiplex_native_player_controls_surface(output: *PlayerControlsSurface) callconv(.c) u32 {
    output.* = player_controls_surface;
    return player_controls_surface.visible;
}

export fn multiplex_native_modal_surface(output: *ModalSurface) callconv(.c) u32 {
    output.* = modal_surface;
    return modal_surface.visible;
}

export fn multiplex_native_poster_surfaces(output: [*]PosterSurface, capacity: u32) callconv(.c) u32 {
    const count = @min(capacity, poster_surface_count);
    @memcpy(output[0..count], poster_surfaces[0..count]);
    return count;
}

export fn multiplex_native_reference_text_overlay(enabled: u32) callconv(.c) void {
    reference_text_overlay_enabled = enabled != 0;
    reference_full_repaint = true;
    previous_render_state_valid = false;
}

/// Build the current live app frame and lower Native SDK's GPU packet into
/// the deliberately small command ABI consumed by the libogc GX presenter.
export fn multiplex_native_app_render(output: [*]GxCommand, capacity: u32) callconv(.c) u32 {
    if (!app_initialized) return 0;
    if (gx_command_cache_valid) {
        const count_u32 = @min(gx_command_cache_count, capacity);
        const count: usize = @intCast(count_u32);
        @memcpy(output[0..count], gx_command_cache[0..count]);
        return count_u32;
    }
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
    captureVideoSurface(layout.nodes, model);
    capturePlayerControlsSurface(layout.nodes);
    captureModalSurface(layout.nodes, model);
    capturePosterSurfaces(layout.nodes);

    var press_ids: [32]canvas.ObjectId = undefined;
    const press_count = collectEnabledPressIds(tree, &press_ids, model);
    if (press_count > 0) resolveFocusedHandler(tree, press_ids[0..press_count], model);
    const focused_id: ?canvas.ObjectId = if (press_count > 0) press_ids[focused_handler] else null;

    display_builder = canvas.Builder.init(&display_commands);
    layout.emitDisplayListWithState(&display_builder, tokens, .{
        .focused_id = focused_id,
        .focus_visible_id = focused_id,
    }) catch return 0;
    const render_plan = display_builder.displayList().renderPlan(&render_commands) catch return 0;
    return lowerGxCommands(render_plan.commands, output, capacity);
}

fn lowerGxCommands(
    commands: []const canvas.RenderCommand,
    output: [*]GxCommand,
    capacity: u32,
) u32 {
    var packet_planner = canvas.CanvasGpuPacketPlanner.init(&gpu_commands);
    const packet = packet_planner.build(.{
        .frame_index = 1,
        .surface_size = .{ .width = 640, .height = 480 },
        .scale = 1,
        .full_repaint = true,
        .dirty_bounds = geometry.RectF.init(0, 0, 640, 480),
        .commands = commands,
    }) catch return 0;
    var output_len: usize = 0;
    for (packet.commands) |command| {
        if (output_len >= capacity) break;
        if (command.kind == .fill_path) {
            output_len += emitGxFillPath(
                command,
                output + output_len,
                @as(usize, capacity) - output_len,
            );
            continue;
        }
        if (command.kind == .stroke_path) {
            output_len += emitGxStrokePath(
                command,
                output + output_len,
                @as(usize, capacity) - output_len,
            );
            continue;
        }
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

/// Drop cached reference-render command results without touching the retained
/// frame already uploaded by the host. The next dirty UI frame repopulates the
/// memo on demand.
export fn multiplex_native_reference_memo_clear() callconv(.c) u32 {
    if (!reference_render_memo_initialized) return 0;
    const released = reference_memo_allocator.bytes_in_use;
    reference_render_memo.deinit();
    return @intCast(released);
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
    captureVideoSurface(layout.nodes, model);
    capturePlayerControlsSurface(layout.nodes);
    captureModalSurface(layout.nodes, model);
    capturePosterSurfaces(layout.nodes);
    reference_render_stage = 3;
    multiplex_native_profile_mark(reference_render_stage);

    var press_ids: [32]canvas.ObjectId = undefined;
    const press_count = collectEnabledPressIds(tree, &press_ids, model);
    if (press_count > 0) resolveFocusedHandler(tree, press_ids[0..press_count], model);
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
    gx_command_cache_count = lowerGxCommands(
        render_plan.commands,
        &gx_command_cache,
        @intCast(gx_command_cache_capacity),
    );
    gx_command_cache_valid = true;
    var reference_command_count: usize = 0;
    for (render_plan.commands) |command| {
        if (isPosterCardChrome(command, model)) continue;
        if (reference_text_overlay_enabled and isGpuImageSurface(command)) continue;
        if (reference_text_overlay_enabled and isGpuChrome(command, model)) continue;
        if (reference_text_overlay_enabled and command.command == .draw_text) continue;
        render_commands[reference_command_count] = command;
        reference_command_count += 1;
    }
    const reference_commands = render_commands[0..reference_command_count];
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
    const content_dirty_bounds: ?geometry.RectF = switch (reference_dirty_region) {
        .none => null,
        .search_input => searchInputDirtyBounds(layout.nodes),
    };
    const full_repaint = reference_full_repaint or !previous_render_state_valid or
        (reference_dirty_region != .none and content_dirty_bounds == null);
    const dirty_bounds = if (full_repaint)
        geometry.RectF.init(0, 0, reference_width, reference_height)
    else if (content_dirty_bounds) |bounds|
        bounds
    else if (layout.renderStateDirtyBoundsWithTokens(
            previous_render_state,
            render_state,
            tokens,
        )) |bounds|
        bounds.inflate(geometry.InsetsF.all(1))
    else
        null;
    reference_dirty_bounds = dirty_bounds;
    reference_last_full_repaint = full_repaint;
    if (reference_text_overlay_enabled and reference_commands.len == 0) {
        clearReferencePixels(pixels, if (full_repaint) null else dirty_bounds);
    } else {
        surface.renderPass(.{
            .frame_index = 1,
            .surface_size = geometry.SizeF.init(reference_width, reference_height),
            .scale = 1,
            .full_repaint = full_repaint,
            .dirty_bounds = dirty_bounds,
            .commands = reference_commands,
        }, if (reference_text_overlay_enabled or
            (model.screen == .player and model.playbackLoaded))
            canvas.Color.rgba8(0, 0, 0, 0)
        else
            canvas.Color.rgb8(10, 10, 12)) catch {
            reference_render_stage = 0x108;
            return 0;
        };
    }

    reference_render_stage = 7;
    multiplex_native_profile_mark(reference_render_stage);
    previous_render_state = render_state;
    previous_render_state_valid = true;
    reference_full_repaint = false;
    reference_dirty_region = .none;
    return @intCast(reference_commands.len);
}

fn clearReferencePixels(pixels: []u8, dirty_bounds: ?geometry.RectF) void {
    const bounds = (dirty_bounds orelse
        geometry.RectF.init(0, 0, reference_width, reference_height)).normalized();
    const left: usize = @intFromFloat(@max(0, @floor(bounds.x)));
    const top: usize = @intFromFloat(@max(0, @floor(bounds.y)));
    const right: usize = @intFromFloat(@min(
        reference_width,
        @ceil(bounds.x + bounds.width),
    ));
    const bottom: usize = @intFromFloat(@min(
        reference_height,
        @ceil(bounds.y + bounds.height),
    ));
    if (right <= left or bottom <= top) return;
    const first_byte = left * 4;
    const row_bytes = (right - left) * 4;
    for (top..bottom) |row| {
        const row_start = row * reference_width * 4 + first_byte;
        @memset(pixels[row_start .. row_start + row_bytes], 0);
    }
}

fn isGpuImageSurface(command: canvas.RenderCommand) bool {
    if (command.command != .draw_image) return false;
    for (poster_surfaces[0..poster_surface_count]) |surface| {
        const poster = geometry.RectF.init(
            surface.x,
            surface.y,
            surface.width,
            surface.height,
        );
        if (command.bounds.intersects(poster)) return true;
    }
    if (video_surface.visible == 0) return false;
    const video = geometry.RectF.init(
        video_surface.x,
        video_surface.y,
        video_surface.width,
        video_surface.height,
    );
    return command.bounds.intersects(video);
}

fn isPosterCardChrome(command: canvas.RenderCommand, model: *const core.Model) bool {
    switch (model.screen) {
        .home, .browse, .search_results => {},
        else => return false,
    }
    const command_id = command.id orelse return false;
    for (poster_card_ids[0..poster_surface_count]) |card_id| {
        if (card_id == 0) continue;
        if (command_id == canvas.widgetPartId(card_id, 1) or
            command_id == canvas.widgetPartId(card_id, 2) or
            command_id == canvas.widgetPartId(card_id, 3)) return true;
    }
    return false;
}

fn isGpuChrome(command: canvas.RenderCommand, model: *const core.Model) bool {
    const supported = switch (command.command) {
        .fill_rect, .fill_rounded_rect, .stroke_rect, .draw_line,
        .stroke_path, .shadow,
        => true,
        .fill_path => model.screen == .player,
        else => false,
    };
    if (!supported) return false;
    if (model.screen != .player) return true;
    if (player_controls_surface.visible != 0) {
        const controls = geometry.RectF.init(
            player_controls_surface.x,
            player_controls_surface.y,
            player_controls_surface.width,
            player_controls_surface.height,
        );
        if (command.bounds.intersects(controls)) return true;
    }
    if (modal_surface.visible == 0) return false;
    const modal = geometry.RectF.init(
        modal_surface.x,
        modal_surface.y,
        modal_surface.width,
        modal_surface.height,
    );
    return command.bounds.intersects(modal);
}

fn searchInputDirtyBounds(nodes: []const canvas.WidgetLayoutNode) ?geometry.RectF {
    for (nodes) |node| {
        if (!std.mem.eql(u8, node.widget.semantics.label, "Search input")) continue;
        return node.frame.normalized().inflate(geometry.InsetsF.all(2));
    }
    return null;
}

fn captureVideoSurface(nodes: []const canvas.WidgetLayoutNode, model: *const core.Model) void {
    video_surface = .{};
    for (nodes) |node| {
        if (node.widget.kind != .media_surface) continue;
        const frame = node.frame.normalized();
        if (frame.isEmpty()) continue;
        video_surface = .{
            .visible = 1,
            .playing = @intFromBool(model.playing),
            .x = frame.x,
            .y = frame.y,
            .width = frame.width,
            .height = frame.height,
        };
        return;
    }
}

fn capturePlayerControlsSurface(nodes: []const canvas.WidgetLayoutNode) void {
    player_controls_surface = .{};
    for (nodes) |node| {
        if (!std.mem.eql(u8, node.widget.semantics.label, "Player controls")) continue;
        const frame = node.frame.normalized();
        if (frame.isEmpty()) continue;
        player_controls_surface = .{
            .visible = 1,
            .x = frame.x,
            .y = frame.y,
            .width = frame.width,
            .height = frame.height,
        };
        return;
    }
}

fn captureModalSurface(nodes: []const canvas.WidgetLayoutNode, model: *const core.Model) void {
    modal_surface = .{};
    const label: []const u8 = if (model.playerSettingsOpen)
        "Playback settings"
    else if (model.startMenuOpen)
        "Multiplex menu"
    else
        return;
    for (nodes) |node| {
        if (node.widget.kind != .panel) continue;
        if (!std.mem.eql(u8, node.widget.semantics.label, label)) continue;
        const frame = node.frame.normalized();
        if (frame.isEmpty()) continue;
        modal_surface = .{
            .visible = 1,
            .x = frame.x,
            .y = frame.y,
            .width = frame.width,
            .height = frame.height,
        };
        return;
    }
}

fn capturePosterSurfaces(nodes: []const canvas.WidgetLayoutNode) void {
    poster_surfaces = [_]PosterSurface{.{}} ** 4;
    poster_card_ids = [_]canvas.ObjectId{0} ** 4;
    poster_surface_count = 0;
    for (nodes) |node| {
        if (node.widget.kind != .image or node.widget.image_id == 0) continue;
        const frame = node.frame.normalized();
        if (frame.isEmpty() or poster_surface_count >= poster_surfaces.len) continue;
        poster_surfaces[poster_surface_count] = .{
            .image_id = @intCast(node.widget.image_id),
            .x = frame.x,
            .y = frame.y,
            .width = frame.width,
            .height = frame.height,
            .radius = node.widget.style.radius orelse 0,
        };
        var ancestor_index = node.parent_index;
        while (ancestor_index) |index| {
            const ancestor = nodes[index];
            if (ancestor.widget.kind == .panel) {
                poster_card_ids[poster_surface_count] = ancestor.widget.id;
                break;
            }
            ancestor_index = ancestor.parent_index;
        }
        poster_surface_count += 1;
    }
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

export fn multiplex_native_reference_dirty_bounds(
    x: *f32,
    y: *f32,
    width: *f32,
    height: *f32,
    full_repaint: *u32,
) callconv(.c) u32 {
    full_repaint.* = @intFromBool(reference_last_full_repaint);
    const bounds = reference_dirty_bounds orelse return 0;
    const normalized = bounds.normalized();
    x.* = normalized.x;
    y.* = normalized.y;
    width.* = normalized.width;
    height.* = normalized.height;
    return 1;
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
            result.x2 = command.bounds.x + command.bounds.width;
            result.y2 = command.bounds.y + command.bounds.height;
            setCommandBoundsClip(&result, command.bounds);
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

fn emitGxStrokePath(
    command: canvas.CanvasGpuCommand,
    output: [*]GxCommand,
    capacity: usize,
) usize {
    if (command.shape != .path or capacity == 0) return 0;
    const elements = command.shape.path;
    const transform = command.transform;
    const scale_x = @sqrt(transform.a * transform.a + transform.b * transform.b);
    const scale_y = @sqrt(transform.c * transform.c + transform.d * transform.d);
    const stroke_width = @max(1, command.stroke_width * (scale_x + scale_y) * 0.5);
    const color = paintRgba(command.paint, command.opacity);
    const round_caps: f32 = if (command.cap == .round) 1 else 0;
    var current = geometry.PointF.zero();
    var subpath_start = geometry.PointF.zero();
    var has_current = false;
    var output_len: usize = 0;

    for (elements) |element| {
        switch (element.verb) {
            .move_to => {
                current = transform.transformPoint(element.points[0]);
                subpath_start = current;
                has_current = true;
            },
            .line_to => {
                if (!has_current) continue;
                const endpoint = transform.transformPoint(element.points[0]);
                output_len += emitGxPathLine(
                    output + output_len,
                    capacity - output_len,
                    current,
                    endpoint,
                    stroke_width,
                    color,
                    round_caps,
                    command.clip,
                );
                current = endpoint;
            },
            .quad_to => {
                if (!has_current) continue;
                const start = current;
                const control = transform.transformPoint(element.points[0]);
                const endpoint = transform.transformPoint(element.points[1]);
                const segment_count: usize = 4;
                for (1..segment_count + 1) |segment| {
                    if (output_len >= capacity) break;
                    const t = @as(f32, @floatFromInt(segment)) /
                        @as(f32, @floatFromInt(segment_count));
                    const inverse = 1 - t;
                    const point = geometry.PointF.init(
                        inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * endpoint.x,
                        inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * endpoint.y,
                    );
                    output_len += emitGxPathLine(
                        output + output_len,
                        capacity - output_len,
                        current,
                        point,
                        stroke_width,
                        color,
                        round_caps,
                        command.clip,
                    );
                    current = point;
                }
                current = endpoint;
            },
            .cubic_to => {
                if (!has_current) continue;
                const start = current;
                const control_a = transform.transformPoint(element.points[0]);
                const control_b = transform.transformPoint(element.points[1]);
                const endpoint = transform.transformPoint(element.points[2]);
                const segment_count: usize = 4;
                for (1..segment_count + 1) |segment| {
                    if (output_len >= capacity) break;
                    const t = @as(f32, @floatFromInt(segment)) /
                        @as(f32, @floatFromInt(segment_count));
                    const inverse = 1 - t;
                    const point = geometry.PointF.init(
                        inverse * inverse * inverse * start.x +
                            3 * inverse * inverse * t * control_a.x +
                            3 * inverse * t * t * control_b.x +
                            t * t * t * endpoint.x,
                        inverse * inverse * inverse * start.y +
                            3 * inverse * inverse * t * control_a.y +
                            3 * inverse * t * t * control_b.y +
                            t * t * t * endpoint.y,
                    );
                    output_len += emitGxPathLine(
                        output + output_len,
                        capacity - output_len,
                        current,
                        point,
                        stroke_width,
                        color,
                        round_caps,
                        command.clip,
                    );
                    current = point;
                }
                current = endpoint;
            },
            .close => {
                if (!has_current) continue;
                output_len += emitGxPathLine(
                    output + output_len,
                    capacity - output_len,
                    current,
                    subpath_start,
                    stroke_width,
                    color,
                    round_caps,
                    command.clip,
                );
                current = subpath_start;
            },
        }
        if (output_len >= capacity) break;
    }
    return output_len;
}

fn emitGxFillPath(
    command: canvas.CanvasGpuCommand,
    output: [*]GxCommand,
    capacity: usize,
) usize {
    if (command.shape != .path or capacity == 0) return 0;
    const transform = command.transform;
    const color = paintRgba(command.paint, command.opacity);
    var first = geometry.PointF.zero();
    var current = geometry.PointF.zero();
    var edge_count: usize = 0;
    var has_current = false;
    var output_len: usize = 0;

    for (command.shape.path) |element| {
        switch (element.verb) {
            .move_to => {
                first = transform.transformPoint(element.points[0]);
                current = first;
                edge_count = 0;
                has_current = true;
            },
            .line_to => {
                if (!has_current) continue;
                const endpoint = transform.transformPoint(element.points[0]);
                output_len += emitGxFillTriangle(
                    output + output_len,
                    capacity - output_len,
                    first,
                    current,
                    endpoint,
                    edge_count,
                    color,
                    command.clip,
                );
                current = endpoint;
                edge_count += 1;
            },
            .quad_to => {
                if (!has_current) continue;
                const start = current;
                const control = transform.transformPoint(element.points[0]);
                const endpoint = transform.transformPoint(element.points[1]);
                const segment_count: usize = 4;
                for (1..segment_count + 1) |segment| {
                    if (output_len >= capacity) break;
                    const t = @as(f32, @floatFromInt(segment)) /
                        @as(f32, @floatFromInt(segment_count));
                    const inverse = 1 - t;
                    const point = geometry.PointF.init(
                        inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * endpoint.x,
                        inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * endpoint.y,
                    );
                    output_len += emitGxFillTriangle(
                        output + output_len,
                        capacity - output_len,
                        first,
                        current,
                        point,
                        edge_count,
                        color,
                        command.clip,
                    );
                    current = point;
                    edge_count += 1;
                }
                current = endpoint;
            },
            .cubic_to => {
                if (!has_current) continue;
                const start = current;
                const control_a = transform.transformPoint(element.points[0]);
                const control_b = transform.transformPoint(element.points[1]);
                const endpoint = transform.transformPoint(element.points[2]);
                const segment_count: usize = 4;
                for (1..segment_count + 1) |segment| {
                    if (output_len >= capacity) break;
                    const t = @as(f32, @floatFromInt(segment)) /
                        @as(f32, @floatFromInt(segment_count));
                    const inverse = 1 - t;
                    const point = geometry.PointF.init(
                        inverse * inverse * inverse * start.x +
                            3 * inverse * inverse * t * control_a.x +
                            3 * inverse * t * t * control_b.x +
                            t * t * t * endpoint.x,
                        inverse * inverse * inverse * start.y +
                            3 * inverse * inverse * t * control_a.y +
                            3 * inverse * t * t * control_b.y +
                            t * t * t * endpoint.y,
                    );
                    output_len += emitGxFillTriangle(
                        output + output_len,
                        capacity - output_len,
                        first,
                        current,
                        point,
                        edge_count,
                        color,
                        command.clip,
                    );
                    current = point;
                    edge_count += 1;
                }
                current = endpoint;
            },
            .close => {},
        }
        if (output_len >= capacity) break;
    }
    return output_len;
}

fn emitGxFillTriangle(
    output: [*]GxCommand,
    capacity: usize,
    first: geometry.PointF,
    previous: geometry.PointF,
    endpoint: geometry.PointF,
    edge_count: usize,
    color_rgba: u32,
    clip_value: ?geometry.RectF,
) usize {
    if (capacity == 0 or edge_count == 0) return 0;
    var translated = GxCommand{
        .kind = gx_fill_triangle,
        .x = first.x,
        .y = first.y,
        .x2 = previous.x,
        .y2 = previous.y,
        .width = endpoint.x,
        .height = endpoint.y,
        .color_rgba = color_rgba,
    };
    copyClip(&translated, clip_value);
    output[0] = translated;
    return 1;
}

fn emitGxPathLine(
    output: [*]GxCommand,
    capacity: usize,
    start: geometry.PointF,
    endpoint: geometry.PointF,
    stroke_width: f32,
    color_rgba: u32,
    round_caps: f32,
    clip_value: ?geometry.RectF,
) usize {
    if (capacity == 0 or
        (@abs(endpoint.x - start.x) < 0.001 and @abs(endpoint.y - start.y) < 0.001)) return 0;
    var translated = GxCommand{
        .kind = gx_path_line,
        .x = start.x,
        .y = start.y,
        .x2 = endpoint.x,
        .y2 = endpoint.y,
        .stroke_width = stroke_width,
        .radius = round_caps,
        .color_rgba = color_rgba,
    };
    copyClip(&translated, clip_value);
    output[0] = translated;
    return 1;
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

fn setCommandBoundsClip(output: *GxCommand, bounds_value: geometry.RectF) void {
    const bounds = bounds_value.normalized();
    const clip = if (output.has_clip != 0)
        geometry.RectF.intersection(bounds, geometry.RectF.init(
            output.clip_x,
            output.clip_y,
            output.clip_width,
            output.clip_height,
        ))
    else
        bounds;
    output.has_clip = 1;
    output.clip_x = clip.x;
    output.clip_y = clip.y;
    output.clip_width = clip.width;
    output.clip_height = clip.height;
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

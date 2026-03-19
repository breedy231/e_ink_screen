// ============================================================
// Kindle Touch 4th Gen — Magnetic Picture Frame Mount
// ============================================================
// Warm, crafted-feeling wall mount. Magnets on the back attach
// to any metal surface. Holds Kindle in portrait OR landscape.
//
// Designed to embrace 3D printing — wider borders, soft edges,
// and a tapered profile that looks intentional with layer lines.
//
// Print settings:
//   - Layer height: 0.2mm
//   - Infill: 20-30%
//   - No supports needed
//   - Print face-down (back plate on bed)
//   - Wood PLA looks great, matte PLA also works well
// ============================================================

// --- PARAMETERS ---

// Kindle Touch 4th Gen
kindle_width  = 120;    // mm (short side)
kindle_height = 172;    // mm (long side)
kindle_depth  = 10.1;   // mm (thickness)

// Tolerance
tolerance = 0.8;        // mm per side

// Frame — wider border for a warm picture-frame feel
frame_border   = 14;    // mm visible frame around kindle
frame_depth    = 8;     // mm total thickness at the base
back_wall      = 2.4;   // mm back plate
lip_width      = 3;     // mm lip overhang to hold kindle

// Front taper — frame gets thinner toward the screen opening
// Creates a gentle bevel that catches light nicely
front_taper    = 2.5;   // mm thinner at the front than at the back edge

// Kindle pocket
pocket_w = kindle_width  + tolerance * 2;
pocket_h = kindle_height + tolerance * 2;

// Overall frame size
frame_w = pocket_w + frame_border * 2;
frame_h = pocket_h + frame_border * 2;

// Soft rounded corners
corner_radius = 10;     // mm — generous for warmth

// Magnets (10mm x 3mm neodymium discs)
magnet_diameter = 10.2;
magnet_depth    = 3.2;
magnet_inset    = 20;   // mm from corner

// Front chamfer on outer edge
chamfer_size = 2.5;     // mm — softens the front face edge

// --- MODULES ---

module rounded_rect(w, h, r) {
    offset(r = r)
        offset(r = -r)
            square([w, h], center = true);
}

module tapered_frame_body() {
    // The frame tapers from full depth at the outer edge
    // to (frame_depth - front_taper) at the pocket edge.
    // This creates a subtle slope on the front face.

    hull() {
        // Back face — full size
        linear_extrude(0.1)
            rounded_rect(frame_w, frame_h, corner_radius);

        // Front face — slightly smaller (creates the taper)
        translate([0, 0, frame_depth])
            linear_extrude(0.1)
                rounded_rect(frame_w - front_taper * 2, frame_h - front_taper * 2, corner_radius - 1);
    }
}

module front_chamfer() {
    // Chamfer the front outer edge for a softer feel
    translate([0, 0, frame_depth - chamfer_size])
        difference() {
            translate([0, 0, 0])
                linear_extrude(chamfer_size + 0.1)
                    rounded_rect(frame_w + 1, frame_h + 1, corner_radius);

            // The chamfer shape — angled cut
            hull() {
                linear_extrude(0.1)
                    rounded_rect(frame_w - front_taper * 2 + 0.2, frame_h - front_taper * 2 + 0.2, corner_radius);
                translate([0, 0, chamfer_size])
                    linear_extrude(0.1)
                        rounded_rect(frame_w - front_taper * 2 - chamfer_size * 2, frame_h - front_taper * 2 - chamfer_size * 2, max(1, corner_radius - chamfer_size));
            }
        }
}

module frame() {
    difference() {
        // Main body with taper
        tapered_frame_body();

        // Kindle pocket — carved from the front
        translate([0, 0, back_wall])
            linear_extrude(frame_depth)
                rounded_rect(pocket_w, pocket_h, max(2, corner_radius - 3));

        // Screen opening through the full frame (the lip is what remains)
        inner_w = pocket_w - lip_width * 2;
        inner_h = pocket_h - lip_width * 2;
        translate([0, 0, -0.1])
            linear_extrude(frame_depth + 1)
                rounded_rect(inner_w, inner_h, max(1, corner_radius - 4));

        // Magnet recesses in the back
        for (pos = magnet_positions()) {
            translate([pos[0], pos[1], -0.1])
                cylinder(d = magnet_diameter, h = magnet_depth + 0.1, $fn = 40);
        }

        // Chamfer the front outer edge
        front_chamfer();
    }
}

function magnet_positions() = [
    [ frame_w/2 - magnet_inset,  frame_h/2 - magnet_inset, 0],
    [-frame_w/2 + magnet_inset,  frame_h/2 - magnet_inset, 0],
    [ frame_w/2 - magnet_inset, -frame_h/2 + magnet_inset, 0],
    [-frame_w/2 + magnet_inset, -frame_h/2 + magnet_inset, 0],
];

// --- RENDER ---

frame();

// --- INFO ---
echo(str("Frame: ", frame_w, " x ", frame_h, " x ", frame_depth, " mm"));
echo(str("Pocket: ", pocket_w, " x ", pocket_h, " mm"));
echo(str("Border width: ", frame_border, " mm"));
echo(str("Magnets: 10x3mm neodymium disc x 4"));
echo(str("Corner radius: ", corner_radius, " mm"));
echo(str("Front taper: ", front_taper, " mm"));

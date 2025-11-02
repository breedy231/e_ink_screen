#!/usr/bin/env python3
"""
E-ink Image Optimizer
Converts PNG images to grayscale format optimized for e-ink displays
"""

import sys
import os
from PIL import Image, ImageOps
import argparse

def optimize_for_eink(input_path, output_path=None):
    """
    Convert image to grayscale format optimized for e-ink display

    Args:
        input_path (str): Path to input image
        output_path (str): Path for output image (optional)

    Returns:
        str: Path to optimized image
    """
    try:
        # Open the image
        with Image.open(input_path) as img:
            print(f"📄 Input: {input_path}")
            print(f"📏 Original size: {img.size}")
            print(f"🎨 Original mode: {img.mode}")

            # Convert to grayscale
            if img.mode != 'L':
                print("🔄 Converting to grayscale...")
                grayscale_img = img.convert('L')
            else:
                grayscale_img = img.copy()

            # Ensure proper size for Kindle (600x800 portrait)
            if grayscale_img.size != (600, 800):
                print(f"🔧 Resizing to 600x800...")
                grayscale_img = grayscale_img.resize((600, 800), Image.LANCZOS)

            # Apply high contrast for better e-ink readability
            print("⚡ Enhancing contrast for e-ink...")
            grayscale_img = ImageOps.autocontrast(grayscale_img, cutoff=1)

            # Set output path
            if output_path is None:
                base, ext = os.path.splitext(input_path)
                output_path = f"{base}_eink_optimized{ext}"

            # Save with optimal settings for e-ink
            print(f"💾 Saving optimized image to: {output_path}")
            grayscale_img.save(
                output_path,
                'PNG',
                optimize=True,
                compress_level=9
            )

            # Get file sizes
            input_size = os.path.getsize(input_path)
            output_size = os.path.getsize(output_path)

            print(f"✅ Optimization complete!")
            print(f"📦 Original size: {input_size / 1024:.1f}KB")
            print(f"📦 Optimized size: {output_size / 1024:.1f}KB")
            print(f"📊 Size change: {((output_size - input_size) / input_size * 100):+.1f}%")

            return output_path

    except Exception as e:
        print(f"❌ Error optimizing image: {e}")
        sys.exit(1)

def verify_eink_compatibility(image_path):
    """
    Verify that an image is compatible with e-ink displays
    """
    try:
        with Image.open(image_path) as img:
            print(f"\n🔍 E-ink Compatibility Check: {os.path.basename(image_path)}")
            print(f"📏 Size: {img.size} {'✅' if img.size == (600, 800) else '❌ Should be 600x800'}")
            print(f"🎨 Mode: {img.mode} {'✅' if img.mode == 'L' else '❌ Should be L (grayscale)'}")
            print(f"📄 Format: {img.format} {'✅' if img.format == 'PNG' else '❌ Should be PNG'}")

            # Check if image has alpha channel
            has_alpha = img.mode in ('RGBA', 'LA') or 'transparency' in img.info
            print(f"🔍 Alpha channel: {'❌ Has alpha (should remove)' if has_alpha else '✅ No alpha'}")

            is_compatible = (
                img.size == (600, 800) and
                img.mode == 'L' and
                img.format == 'PNG' and
                not has_alpha
            )

            print(f"\n{'✅ E-ink compatible!' if is_compatible else '❌ Needs optimization'}")
            return is_compatible

    except Exception as e:
        print(f"❌ Error checking compatibility: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Optimize images for e-ink displays')
    parser.add_argument('input', help='Input image path')
    parser.add_argument('-o', '--output', help='Output image path')
    parser.add_argument('--check', action='store_true', help='Only check compatibility, don\'t optimize')

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"❌ Input file not found: {args.input}")
        sys.exit(1)

    if args.check:
        verify_eink_compatibility(args.input)
    else:
        output_path = optimize_for_eink(args.input, args.output)
        print(f"\n🔍 Verifying optimized image...")
        verify_eink_compatibility(output_path)

if __name__ == '__main__':
    main()
#!/usr/bin/env python3
"""
E-ink Sprite Optimizer
Converts Pokemon sprites to grayscale format optimized for e-ink displays
Handles transparent backgrounds by converting to white
"""

import sys
import os
from PIL import Image, ImageOps
import argparse

def optimize_sprite_for_eink(input_path, output_path=None):
    """
    Convert sprite image to grayscale format optimized for e-ink display
    Converts transparent backgrounds to white

    Args:
        input_path (str): Path to input sprite image
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

            # Handle transparent background by compositing on white
            if img.mode in ('RGBA', 'LA') or 'transparency' in img.info or img.mode == 'P':
                print("🔄 Converting transparent background to white...")
                # Create white background
                background = Image.new('RGB', img.size, (255, 255, 255))

                # Convert palette mode to RGBA first if needed
                if img.mode == 'P':
                    img = img.convert('RGBA')

                # Paste sprite on white background using alpha channel
                if img.mode in ('RGBA', 'LA'):
                    background.paste(img, (0, 0), img)
                else:
                    background.paste(img, (0, 0))
                img = background
            elif img.mode != 'RGB':
                # Convert other modes to RGB first
                img = img.convert('RGB')

            # Convert to grayscale
            print("🔄 Converting to grayscale...")
            grayscale_img = img.convert('L')

            # Apply high contrast for better e-ink readability
            print("⚡ Enhancing contrast for e-ink...")
            grayscale_img = ImageOps.autocontrast(grayscale_img, cutoff=2)

            # Set output path
            if output_path is None:
                base, ext = os.path.splitext(input_path)
                output_path = f"{base}_eink{ext}"

            # Save with optimal settings for e-ink
            print(f"💾 Saving optimized sprite to: {output_path}")
            grayscale_img.save(
                output_path,
                'PNG',
                optimize=True,
                compress_level=9
            )

            # Get file sizes
            input_size = os.path.getsize(input_path)
            output_size = os.path.getsize(output_path)

            print(f"✅ Sprite optimization complete!")
            print(f"📦 Original size: {input_size / 1024:.1f}KB")
            print(f"📦 Optimized size: {output_size / 1024:.1f}KB")
            print(f"📊 Size change: {((output_size - input_size) / input_size * 100):+.1f}%")

            return output_path

    except Exception as e:
        print(f"❌ Error optimizing sprite: {e}")
        raise

def main():
    parser = argparse.ArgumentParser(description='Optimize sprite images for e-ink displays')
    parser.add_argument('input', help='Input sprite image path')
    parser.add_argument('-o', '--output', help='Output image path')

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"❌ Input file not found: {args.input}")
        sys.exit(1)

    optimize_sprite_for_eink(args.input, args.output)

if __name__ == '__main__':
    main()

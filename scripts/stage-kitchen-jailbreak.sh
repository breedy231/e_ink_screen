#!/usr/bin/env bash
#
# Stage the kitchen Kindle (Paperwhite 3, DP75SDI, FW 5.12.3) jailbreak
# artifacts: download, verify, and copy to the mounted device.
#
# Runs on the Mac. Automates every part of the bootstrap that is a file copy or
# a download; the device-UI steps it cannot do are printed as explicit prompts.
# See KITCHEN_SCREEN_PLAN.md for the reasoning behind each step.
#
#   ./scripts/stage-kitchen-jailbreak.sh fetch     # download + verify only
#   ./scripts/stage-kitchen-jailbreak.sh jailbreak # copy WinterBreak2 to device
#   ./scripts/stage-kitchen-jailbreak.sh ssh       # copy MRPI + usbnet + KUAL
#   ./scripts/stage-kitchen-jailbreak.sh cleanup   # strip .bin/filler from root
#
set -e

STAGE_DIR="${STAGE_DIR:-$HOME/.cache/kindle-kitchen-jailbreak}"
KINDLE_VOL="${KINDLE_VOL:-/Volumes/Kindle}"

# Artifact URLs and sha256s were verified against kindlemodding.org and the
# upstream release assets on 2026-08-16. A checksum of "-" means upstream
# publishes no checksum and none was independently established: the script
# records what it got instead of pretending to verify it.
#
# format: name|url|sha256
ARTIFACTS='
wb2.zip|https://github.com/KindleModding/WinterBreak2/releases/latest/download/wb2.zip|932ff113c414c9b0109b98d7f4b96da20815364fb4905e4483581b881b2ae2e2
kual-mrinstaller.zip|https://kindlemodding.org/jailbreaking/Legacy/post-jailbreak/installing-kual-mrpi/kual-mrinstaller-khf.zip|-
usbnet.tar.xz|https://storage.gra.cloud.ovh.net/v1/AUTH_2ac4bfee353948ec8ea7fd1710574097/mr-public/Touch/kindle-usbnet-0.22.N-r19297.tar.xz|cf971557d42cc0a6d7699f1c743108c681fa41e3d67ee5802a91932d130d4032
PEKI.zip|https://github.com/KindleTweaks/PEKI/releases/latest/download/PEKI.zip|-
'

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# Device-UI steps cannot be scripted. Rather than bury them in a README, stop
# and make the human confirm — the sequencing (airplane mode on/off at the
# right moments) is what protects against a mid-process OTA.
manual() {
    printf '\n\033[1;35m[MANUAL — do this on the device now]\033[0m\n'
    printf '  %s\n' "$@"
    printf '\nPress Return when done, Ctrl-C to abort. '
    read -r _
}

require_kindle() {
    [ -d "$KINDLE_VOL" ] || die "Kindle not mounted at $KINDLE_VOL (set KINDLE_VOL=...)"
    # A jailbroken device is a different situation than a stock one; say which.
    if [ -f "$KINDLE_VOL/documents/JAILBROKEN.txt" ]; then
        log "Device reports: already jailbroken"
    fi
}

free_mb() {
    df -m "$KINDLE_VOL" | awk 'NR==2 {print $4}'
}

fetch() {
    mkdir -p "$STAGE_DIR"
    echo "$ARTIFACTS" | while IFS='|' read -r name url want; do
        [ -n "$name" ] || continue
        local_path="$STAGE_DIR/$name"

        if [ ! -f "$local_path" ]; then
            log "Downloading $name"
            curl -fL --progress-bar -o "$local_path.part" "$url" \
                || die "download failed: $url"
            mv "$local_path.part" "$local_path"
        else
            log "Cached $name"
        fi

        got=$(shasum -a 256 "$local_path" | awk '{print $1}')
        if [ "$want" = "-" ]; then
            warn "$name: no published checksum to verify against (got $got)"
        elif [ "$got" != "$want" ]; then
            die "$name CHECKSUM MISMATCH
  expected $want
  got      $got
Do not use this file. Re-download, or the upstream release changed."
        else
            log "$name checksum OK"
        fi
    done
    log "Artifacts staged in $STAGE_DIR"
}

# `ditto` rather than cp/Finder: the WinterBreak payload lives in the
# dot-directory .active_content_sandbox, which Finder drag-and-drop silently
# skips. That silent skip is the single most common macOS failure here.
copy_tree() {
    ditto "$1" "$2" || die "copy failed: $1 -> $2"
}

finish_device_copy() {
    log "Stripping AppleDouble junk"
    dot_clean -m "$KINDLE_VOL" 2>/dev/null || warn "dot_clean failed (non-fatal)"
    sync
    log "Ejecting"
    diskutil eject "$KINDLE_VOL" >/dev/null || warn "eject failed — eject manually before touching the device"
}

clean_root() {
    log "Removing staged update binaries from device root"
    rm -f "$KINDLE_VOL"/*.bin "$KINDLE_VOL"/update.bin.tmp.partial 2>/dev/null || true
}

cmd_jailbreak() {
    fetch
    require_kindle

    manual "Turn Airplane Mode ON (Settings -> Airplane Mode)." \
           "This must stay on until the browser step, so a background OTA" \
           "cannot land while we work."

    clean_root

    avail=$(free_mb)
    log "Free space on device: ${avail} MB"
    if [ "$avail" -gt 90 ]; then
        warn "More than 90 MB free."
        warn "The fill-storage step is what makes an OTA unable to complete."
        warn "Fill to 50-90 MB free (see Kindle-Filler-Disk in the plan), then re-run."
        manual "Fill storage to 50-90 MB free, then continue."
    fi

    log "Extracting WinterBreak2"
    rm -rf "$STAGE_DIR/wb2"
    mkdir -p "$STAGE_DIR/wb2"
    # Extract on the Mac first — extracting straight onto the Kindle's vfat
    # is documented as failing.
    unzip -oq "$STAGE_DIR/wb2.zip" -d "$STAGE_DIR/wb2" || die "unzip failed"

    log "Copying WinterBreak2 to device root"
    copy_tree "$STAGE_DIR/wb2" "$KINDLE_VOL"

    # Fail loudly if the payload did not land, rather than sending the user off
    # to a browser step that will silently do nothing.
    [ -f "$KINDLE_VOL/jb.sh" ] || die "jb.sh missing from device root — copy did not land"
    [ -d "$KINDLE_VOL/winterbreak2" ] || die "winterbreak2/ missing from device root"
    log "Verified: jb.sh + winterbreak2/ present"

    finish_device_copy

    manual "1. Turn Airplane Mode OFF and connect to WiFi." \
           "   (The jailbreak downloads its payload at run time — it is NOT" \
           "    in the zip. No internet, no jailbreak.)" \
           "2. Open the Experimental Browser." \
           "3. Go to: https://winterbreak2.now.sh/" \
           "4. Press Jailbreak. Wait ~30s for text + a GUI restart." \
           "" \
           "'Failed to remount rootfs RO, waiting' is EXPECTED — hold power," \
           "then restart. But 'You are now ready to install the hotfix' means" \
           "it FAILED — retry."

    log "Jailbreak stage done. Do NOT install a hotfix — WinterBreak2 already"
    log "blocked OTA and applied the system patches. Next: '$0 ssh'"
}

cmd_ssh() {
    fetch
    require_kindle

    avail=$(free_mb)
    log "Free space on device: ${avail} MB"
    if [ "$avail" -lt 220 ]; then
        warn "MRPI needs ~220 MB free; only ${avail} MB available."
        manual "Free space to >=220 MB, with Airplane Mode ON." \
               "(Freeing it online invites the OTA you just blocked.)"
    fi

    log "Extracting MRPI + usbnet + PEKI"
    rm -rf "$STAGE_DIR/work"; mkdir -p "$STAGE_DIR/work"
    unzip -oq "$STAGE_DIR/kual-mrinstaller.zip" -d "$STAGE_DIR/work/mrpi" || die "mrpi unzip failed"
    tar -xf "$STAGE_DIR/usbnet.tar.xz" -C "$STAGE_DIR/work" || die "usbnet extract failed"
    unzip -oq "$STAGE_DIR/PEKI.zip" -d "$STAGE_DIR/work/peki" || die "peki unzip failed"

    log "Copying MRPI extensions/ + mrpackages/ to device"
    for d in extensions mrpackages; do
        src=$(find "$STAGE_DIR/work/mrpi" -type d -name "$d" -maxdepth 3 | head -1)
        [ -n "$src" ] || die "MRPI archive has no $d/ — layout changed upstream"
        mkdir -p "$KINDLE_VOL/$d"
        copy_tree "$src" "$KINDLE_VOL/$d"
    done

    # PW3 takes the pw2_and_up build. The touch_pw variant is PW1/Touch only —
    # installing the wrong one is a silent no-op.
    usbnet_bin=$(find "$STAGE_DIR/work" -name 'Update_usbnet_*install_pw2_and_up.bin' | head -1)
    [ -n "$usbnet_bin" ] || die "usbnet pw2_and_up .bin not found — do NOT substitute the touch_pw build"
    log "Staging $(basename "$usbnet_bin") into mrpackages/"
    cp "$usbnet_bin" "$KINDLE_VOL/mrpackages/"

    log "Copying KUAL (PEKI) to documents/"
    mkdir -p "$KINDLE_VOL/documents"
    for f in KUAL.sh KUAL.jar; do
        src=$(find "$STAGE_DIR/work/peki" -name "$f" | head -1)
        if [ -n "$src" ]; then cp "$src" "$KINDLE_VOL/documents/"; else warn "PEKI archive missing $f"; fi
    done

    finish_device_copy

    manual "1. In the search bar type:  ;log mrpi" \
           "   (installs the staged usbnet package)" \
           "2. Then start usbnet with:  ;un" \
           "3. Connect USB and check from this Mac:" \
           "      sudo ifconfig usb0 192.168.15.201" \
           "      ssh root@192.168.15.244        # no password over USB" \
           "" \
           "Over USB dropbear runs with -n (no password check). Do NOT" \
           "enable USE_WIFI until keys are installed — see setup-kitchen-kindle.sh"

    log "SSH stage done. Next: ./scripts/setup-kitchen-kindle.sh"
}

cmd_cleanup() {
    require_kindle
    clean_root
    rm -f "$KINDLE_VOL/fill_disk" "$KINDLE_VOL/Filler.sh" 2>/dev/null || true
    log "Root cleaned"
    finish_device_copy
}

case "${1:-}" in
    fetch)     fetch ;;
    jailbreak) cmd_jailbreak ;;
    ssh)       cmd_ssh ;;
    cleanup)   cmd_cleanup ;;
    *)
        sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac

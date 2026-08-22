import Darwin
import Foundation

/// macOS attributes a CLI tool's Accessibility permission to the *app that
/// launched it*, which for a build tool is several processes up the tree.
/// This walks the ancestry so the user knows which app to actually grant.
enum Diagnostics {
    static func parentPid(of pid: pid_t) -> pid_t? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0 else { return nil }
        let ppid = info.kp_eproc.e_ppid
        return ppid > 0 ? ppid : nil
    }

    static func path(of pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: Int(4 * MAXPATHLEN))
        let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        guard length > 0 else { return nil }
        return String(cString: buffer)
    }

    /// Walks up from this process, stopping at the first .app bundle — that is
    /// the one TCC will hold responsible.
    static func ancestry() -> (chain: [String], responsibleApp: String?) {
        var chain: [String] = []
        var responsible: String?
        var pid: pid_t? = getpid()
        var hops = 0

        while let current = pid, hops < 12 {
            if let full = path(of: current) {
                chain.append(full)
                if responsible == nil, let range = full.range(of: ".app/") {
                    responsible = String(full[full.startIndex ..< range.lowerBound]) + ".app"
                }
            }
            pid = parentPid(of: current)
            hops += 1
        }
        return (chain, responsible)
    }

    static func report() {
        let trusted = Injector.isTrusted()
        let (chain, responsible) = ancestry()

        print("deckd-input — doctor")
        print("")
        print("binary   : \(path(of: getpid()) ?? "?")")
        print("trusted  : \(trusted ? "YA — boleh inject input" : "TIDAK — semua event bakal dibuang diam-diam")")
        print("")
        print("rantai proses (dari binary ke atas):")
        for (index, entry) in chain.enumerated() {
            print("  \(index == 0 ? "→" : " ") \(URL(fileURLWithPath: entry).lastPathComponent)   \(entry)")
        }
        print("")

        if trusted {
            print("Beres. Lanjut: make type / make move")
            return
        }

        if let app = responsible {
            print("KASIH IZIN KE APP INI:")
            print("  \(app)")
            print("")
            print("System Settings → Privacy & Security → Accessibility → '+' → pilih app di atas,")
            print("nyalakan togglenya, lalu QUIT TOTAL app itu (Cmd+Q) dan buka lagi.")
        } else {
            print("Nggak ketemu .app di rantai proses — kemungkinan ini dijalanin dari daemon/SSH.")
            print("Jalanin ulang dari Terminal.app biasa, lalu kasih izin ke Terminal.app.")
        }
        print("")
        print("Kalau ragu: pakai Terminal.app biasa, jangan terminal bawaan editor —")
        print("izinnya nempel ke editor (mis. Visual Studio Code), bukan ke terminalnya.")
    }

    /// Polls until the permission flips, so the user gets a clear confirmation
    /// instead of having to guess whether the toggle took effect.
    static func waitForTrust(timeout: Int) {
        print("Nunggu Accessibility dikasih (maks \(timeout) detik)... Ctrl-C buat batal.")
        for elapsed in 0 ..< timeout {
            if Injector.isTrusted() {
                print("\nOK — trusted setelah \(elapsed) detik. Lanjut: make type")
                exit(0)
            }
            if elapsed % 5 == 0 && elapsed > 0 {
                print("  ...\(elapsed)s")
            }
            sleep(1)
        }
        print("\nMasih belum trusted setelah \(timeout) detik.")
        print("Kalau toggle-nya sudah dinyalakan tapi tetap merah: QUIT TOTAL app-nya (Cmd+Q), buka lagi, ulangi.")
        exit(1)
    }
}

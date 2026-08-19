fn main() {
    let root_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let mh_dir = std::path::Path::new(&root_dir).join("vendor/minhook");
    let mh_src = mh_dir.join("src");
    let target = std::env::var("TARGET").unwrap();
    let arch = target.splitn(4, '-').next().unwrap();

    let hde = if arch == "i686" {
        "hde/hde32.c"
    } else if arch == "x86_64" {
        "hde/hde64.c"
    } else {
        panic!("unsupported arch {arch}");
    };

    cc::Build::new()
        .flag("-ffunction-sections")
        .flag("-fdata-sections")
        .file(mh_src.join("buffer.c"))
        .file(mh_src.join("hook.c"))
        .file(mh_src.join("trampoline.c"))
        .file(mh_src.join(hde))
        .compile("libminhook.a");

    println!("cargo:rerun-if-changed=vendor/minhook");
}
// 大师拷贝官网 · 共用脚本：主题切换、目录高亮、复制按钮、下载区版本信息。
// 页面不依赖脚本也能完整阅读；脚本只负责这些增强。
(() => {
  const root = document.documentElement;
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* 隐私模式等场景写不进去，忽略 */ } },
  };

  // ---------- 主题：默认暗色，不跟随系统；按钮在暗色与浅色之间切换，选择记在本机 ----------
  const THEME_LABEL = { dark: "切换到浅色", light: "切换到深色" };
  const applyTheme = (mode) => {
    root.setAttribute("data-theme", mode);
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.setAttribute("aria-label", THEME_LABEL[mode]);
      btn.setAttribute("title", THEME_LABEL[mode]);
    });
  };
  let themeMode = store.get("dl-site-theme") === "light" ? "light" : "dark";
  applyTheme(themeMode);
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-theme-toggle]")) return;
    themeMode = themeMode === "dark" ? "light" : "dark";
    store.set("dl-site-theme", themeMode);
    applyTheme(themeMode);
  });

  // ---------- 手机端导航 ----------
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-menu-toggle]");
    const header = document.querySelector(".site-header");
    if (!header) return;
    if (toggle) {
      const open = !header.hasAttribute("data-open");
      header.toggleAttribute("data-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    } else if (event.target.closest(".nav a")) {
      header.removeAttribute("data-open");
    }
  });

  // ---------- 目录高亮 ----------
  const tocLinks = [...document.querySelectorAll(".toc a[href^='#']")];
  if (tocLinks.length && "IntersectionObserver" in window) {
    const byId = new Map(tocLinks.map((a) => [decodeURIComponent(a.getAttribute("href").slice(1)), a]));
    const visible = new Set();
    const mark = () => {
      const first = [...byId.keys()].find((id) => visible.has(id));
      tocLinks.forEach((a) => a.removeAttribute("data-active"));
      if (first) byId.get(first).setAttribute("data-active", "");
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id)));
      mark();
    }, { rootMargin: "-80px 0px -55% 0px" });
    byId.forEach((_, id) => { const el = document.getElementById(id); if (el) observer.observe(el); });
  }

  // ---------- 代码块复制 ----------
  document.querySelectorAll("pre.code").forEach((pre) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "复制";
    btn.addEventListener("click", async () => {
      const text = [...pre.querySelectorAll("code")].map((c) => c.innerText).join("\n") || pre.innerText;
      const clean = text.split("\n").map((line) => line.replace(/^\$ /, "")).join("\n").trim();
      try {
        await navigator.clipboard.writeText(clean);
        btn.textContent = "已复制";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(pre.querySelector("code") || pre);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = "已选中，按 ⌘C";
      }
      setTimeout(() => { btn.textContent = "复制"; }, 1600);
    });
    pre.appendChild(btn);
  });

  // ---------- 下载区：从下载服务读当前稳定版的版本号、大小与发布日期；读不到就保留静态文字 ----------
  const releaseVersion = document.querySelector("[data-release-version]");
  if (releaseVersion && "fetch" in window) {
    fetch("https://dl.if9.cool/v1/app/mascopy/stable", { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((release) => {
        const mac = release?.downloads?.["darwin-aarch64"];
        if (!release?.version || !mac) return;
        releaseVersion.textContent = `v${release.version}`;
        const meta = document.querySelector("[data-release-meta]");
        const size = mac.size ? ` · ${(mac.size / 1024 / 1024).toFixed(1)} MB` : "";
        const date = release.pub_date ? ` · ${release.pub_date.slice(0, 10)} 发布` : "";
        if (meta) meta.textContent = `macOS 安装包（.dmg），Apple 芯片${size}${date}。`;
      })
      .catch(() => { /* 下载服务不可达时保留静态文字；按钮本身直链稳定版 */ });
  }

})();

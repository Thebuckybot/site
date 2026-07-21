/* Bucky landing — GSAP scroll experience (dark V2, refinement pass).
   Horizontal Security flagship + dedicated Economy/Adventures/Arcade sections,
   floating coin art, art parallax, animated stats. Honours reduced-motion. */
gsap.registerPlugin(ScrollTrigger);
gsap.config({ nullTargetWarn: false });

const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function initNav() {
  const nav = document.querySelector(".site-nav");
  if (!nav) return;
  const sync = () => nav.classList.toggle("scrolled", window.scrollY > 40);
  sync();
  window.addEventListener("scroll", sync, { passive: true });
}

function initHero() {
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from(".hero-eyebrow", { y: 20, opacity: 0, duration: 0.6 })
    .from(".hero-text h1", { y: 44, opacity: 0, duration: 0.9 }, "-=0.3")
    .from(".hero-text p", { y: 30, opacity: 0, duration: 0.7 }, "-=0.6")
    .from(".hero-cta", { y: 24, opacity: 0, duration: 0.6 }, "-=0.5")
    .from(".hero-visual img", { scale: 0.9, opacity: 0, duration: 1.0 }, "-=0.8");
  gsap.to(".hero-visual img", { yPercent: 12, scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
}

function initHorizontal() {
  const wrap = document.querySelector(".hwrap");
  const panels = gsap.utils.toArray(".hpanel");
  const rail = document.getElementById("hrail");
  if (!wrap || panels.length < 2) return;
  const tween = gsap.to(panels, { xPercent: -100 * (panels.length - 1), ease: "none" });
  ScrollTrigger.create({
    trigger: ".flagship", start: "top top", end: () => "+=" + wrap.offsetWidth,
    pin: true, scrub: 0.6, animation: tween, invalidateOnRefresh: true,
    onUpdate: (self) => { if (rail) rail.style.width = (self.progress * 100).toFixed(2) + "%"; },
  });
  panels.forEach((p) => {
    const items = p.querySelectorAll("[data-rv]");
    if (items.length) gsap.from(items, { opacity: 0, y: 50, duration: 0.7, stagger: 0.08, ease: "power2.out",
      scrollTrigger: { trigger: p, containerAnimation: tween, start: "left 68%", toggleActions: "play none none reverse" } });
    const frame = p.querySelector(".browser");
    if (frame) gsap.from(frame, { opacity: 0, scale: 0.92, y: 40, duration: 0.9, ease: "power2.out",
      scrollTrigger: { trigger: p, containerAnimation: tween, start: "left 78%", toggleActions: "play none none reverse" } });
  });
}

function revealBatch(selector, opts = {}) {
  gsap.utils.toArray(selector).forEach((elm, i) => {
    gsap.from(elm, {
      opacity: 0, y: opts.y || 40, duration: 0.65, delay: (i % (opts.mod || 4)) * 0.06, ease: "power2.out",
      scrollTrigger: { trigger: elm, start: opts.start || "top 86%", toggleActions: "play none none reverse" },
    });
  });
}

function initProductSections() {
  revealBatch(".feature-card", { mod: 4 });
  // text + media of each product section
  gsap.utils.toArray(".product").forEach((sec) => {
    const text = sec.querySelectorAll(".product-text > *");
    const media = sec.querySelector(".product-media");
    if (text.length) gsap.from(text, { opacity: 0, y: 34, duration: 0.6, stagger: 0.07, ease: "power2.out",
      scrollTrigger: { trigger: sec, start: "top 72%", toggleActions: "play none none reverse" } });
    if (media) gsap.from(media, { opacity: 0, y: 46, scale: 0.96, duration: 0.8, ease: "power2.out",
      scrollTrigger: { trigger: sec, start: "top 72%", toggleActions: "play none none reverse" } });
  });
  // section headings (features + why)
  revealBatch(".features .section-head", { mod: 1, start: "top 80%" });
}

function initCoins() {
  gsap.utils.toArray(".coin").forEach((c, i) => {
    gsap.to(c, { y: "+=18", rotation: i % 2 ? 5 : -5, duration: 2.6 + i * 0.5, repeat: -1, yoyo: true, ease: "sine.inOut" });
  });
  // subtle parallax on the framed art
  gsap.utils.toArray(".art-tilt").forEach((a) => {
    gsap.fromTo(a, { yPercent: 6 }, { yPercent: -6, ease: "none",
      scrollTrigger: { trigger: a, start: "top bottom", end: "bottom top", scrub: true } });
  });
}

function init() {
  initNav();
  ScrollTrigger.config({ ignoreMobileResize: true });

  if (REDUCE) {
    document.body.classList.add("no-motion");
    return;
  }

  initHero();
  initProductSections();
  initCoins();
  ScrollTrigger.matchMedia({
    "(min-width: 821px)": function () { initHorizontal(); },
  });
}

window.addEventListener("load", init);

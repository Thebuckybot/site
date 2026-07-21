/* Bucky landing — GSAP scroll experience (dark V2).
   Horizontal-pinned Security flagship showcase, hero intro/parallax, reveals,
   and a progress rail. Fully honours prefers-reduced-motion. */
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
  gsap.to(".hero-visual img", {
    yPercent: 12,
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true },
  });
}

function initHorizontal() {
  const wrap = document.querySelector(".hwrap");
  const panels = gsap.utils.toArray(".hpanel");
  const rail = document.getElementById("hrail");
  if (!wrap || panels.length < 2) return;

  const tween = gsap.to(panels, { xPercent: -100 * (panels.length - 1), ease: "none" });

  ScrollTrigger.create({
    trigger: ".flagship",
    start: "top top",
    end: () => "+=" + wrap.offsetWidth,
    pin: true,
    scrub: 0.6,
    animation: tween,
    invalidateOnRefresh: true,
    onUpdate: (self) => { if (rail) rail.style.width = (self.progress * 100).toFixed(2) + "%"; },
  });

  panels.forEach((p) => {
    const items = p.querySelectorAll("[data-rv]");
    if (items.length) {
      gsap.from(items, {
        opacity: 0, y: 50, duration: 0.7, stagger: 0.08, ease: "power2.out",
        scrollTrigger: { trigger: p, containerAnimation: tween, start: "left 68%", toggleActions: "play none none reverse" },
      });
    }
    const frame = p.querySelector(".browser");
    if (frame) {
      gsap.from(frame, {
        opacity: 0, scale: 0.92, y: 40, duration: 0.9, ease: "power2.out",
        scrollTrigger: { trigger: p, containerAnimation: tween, start: "left 78%", toggleActions: "play none none reverse" },
      });
    }
  });
}

function initReveals() {
  gsap.utils.toArray(".fcard").forEach((c, i) => {
    gsap.from(c, {
      opacity: 0, y: 40, duration: 0.6, delay: (i % 3) * 0.06, ease: "power2.out",
      scrollTrigger: { trigger: c, start: "top 86%", toggleActions: "play none none reverse" },
    });
  });
  const finalKids = document.querySelectorAll(".final-inner > *");
  if (finalKids.length) {
    gsap.from(finalKids, {
      opacity: 0, y: 30, duration: 0.7, stagger: 0.1, ease: "power2.out",
      scrollTrigger: { trigger: ".final", start: "top 78%" },
    });
  }
}

function init() {
  initNav();
  ScrollTrigger.config({ ignoreMobileResize: true });

  if (REDUCE) {
    // No motion: stack the flagship so every panel is reachable, no animation.
    document.body.classList.add("no-motion");
    return;
  }

  initHero();
  ScrollTrigger.matchMedia({
    "(min-width: 821px)": function () { initHorizontal(); initReveals(); },
    "(max-width: 820px)": function () { initReveals(); },
  });
}

window.addEventListener("load", init);

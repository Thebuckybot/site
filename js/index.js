gsap.registerPlugin(ScrollTrigger);

/* =====================================================
   GLOBAL SETTINGS
===================================================== */

gsap.config({
  nullTargetWarn: false
});

/* =====================================================
   NAVBAR TRANSFORM
===================================================== */

function initNavbar() {

  gsap.to(".navbar", {
    scrollTrigger: {
      trigger: ".hero",
      start: "bottom top",
      toggleActions: "play none none reverse"
    },
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
    duration: 0.3,
    ease: "power2.out"
  });

}

/* =====================================================
   HERO INTRO ANIMATION
===================================================== */

function initHeroIntro() {

  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

  tl.from(".hero-text h1", {
    y: 80,
    opacity: 0,
    duration: 1
  })
  .from(".hero-text p", {
    y: 40,
    opacity: 0,
    duration: 0.8
  }, "-=0.6")
  .from(".cta-btn", {
    y: 30,
    opacity: 1,
    duration: 0.6
  }, "-=0.6")
}

/* =====================================================
   HERO PARALLAX
===================================================== */

function initHeroParallax() {

  gsap.to(".bucky", {
    scrollTrigger: {
      trigger: ".hero",
      start: "top top",
      end: "bottom top",
      scrub: true
    },
    y: 760,
    x: 200,
    scale: 0.45,
    rotate: 250,
    ease: "none"
  });

  gsap.to(".hero-text", {
    scrollTrigger: {
      trigger: ".hero",
      start: "top top",
      end: "bottom top",
      scrub: true
    },
    y: -220,
    opacity: 0,
    ease: "none"
  });

}

/* =====================================================
   HORIZONTAL MASTER
===================================================== */

function initHorizontal() {

  const horizontalWrapper = document.querySelector(".horizontal-wrapper");
  const panels = gsap.utils.toArray(".panel");

  const horizontalTween = gsap.to(panels, {
    xPercent: -100 * (panels.length - 1),
    ease: "none"
  });

  ScrollTrigger.create({
    trigger: ".horizontal-section",
    start: "top top",
    end: () => "+=" + horizontalWrapper.offsetWidth,
    pin: true,
    scrub: true,
    animation: horizontalTween
  });

  panels.forEach(panel => {

    gsap.from(panel.querySelectorAll("h2, p, li"), {
      opacity: 0,
      y: 60,
      duration: 0.8,
      stagger: 0.08,
      ease: "power2.out",
      scrollTrigger: {
        trigger: panel,
        containerAnimation: horizontalTween,
        start: "center 75%",
        toggleActions: "play none none reverse"
      }
    });

  });

  return horizontalTween;

}

/* =====================================================
   CURRENCY FLOAT ANIMATION
===================================================== */

function initCurrencyFloat() {

  gsap.utils.toArray(".currency-item").forEach((item, i) => {

    gsap.to(item, {
      y: -20,
      duration: 2 + i,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });

  });

}

/* =====================================================
   ARCADE CARD HOVER
===================================================== */

function initArcadeCards() {

  const cards = document.querySelectorAll(".game-card");

  cards.forEach(card => {

    card.addEventListener("mouseenter", () => {
      gsap.to(card, {
        scale: 1.05,
        rotateY: 8,
        duration: 0.4,
        ease: "power2.out"
      });
    });

    card.addEventListener("mouseleave", () => {
      gsap.to(card, {
        scale: 1,
        rotateY: 0,
        duration: 0.4,
        ease: "power2.out"
      });
    });

  });

}

/* =====================================================
   BACKGROUND COLOR TRANSITIONS
===================================================== */

function initBackgroundTransitions(horizontalTween) {

  const panels = gsap.utils.toArray(".panel");

  panels.forEach(panel => {

    ScrollTrigger.create({
      trigger: panel,
      containerAnimation: horizontalTween,
      start: "center center",
      onEnter: () => {
        gsap.to("body", {
          backgroundColor: getComputedStyle(panel).backgroundColor,
          duration: 0.6
        });
      },
      onEnterBack: () => {
        gsap.to("body", {
          backgroundColor: getComputedStyle(panel).backgroundColor,
          duration: 0.6
        });
      }
    });

  });

}




/* =====================================================
   PANEL IMAGE DEPTH
===================================================== */

function initPanelDepth(horizontalTween) {

  gsap.utils.toArray(".panel-image").forEach(img => {

    gsap.from(img, {
      scale: 0.8,
      opacity: 0,
      duration: 1,
      scrollTrigger: {
        trigger: img,
        containerAnimation: horizontalTween,
        start: "left center",
        toggleActions: "play none none reverse"
      }
    });

  });

}

/* =====================================================
   PANEL LINK REVEAL
===================================================== */

function initPanelLinks(horizontalTween) {

  gsap.utils.toArray(".panel-link").forEach(link => {

    gsap.from(link, {
      x: -30,
      opacity: 0,
      duration: 0.6,
      scrollTrigger: {
        trigger: link,
        containerAnimation: horizontalTween,
        start: "left 80%"
      }
    });

  });

}

/* =====================================================
   CURRENCY CHAOS MOTION
===================================================== */

function initCurrencyChaos() {

  gsap.utils.toArray(".currency-item").forEach((item, i) => {

    gsap.to(item, {
      y: "random(-40, 40)",
      x: "random(-20, 20)",
      rotation: "random(-20, 20)",
      duration: 6 + i,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });

  });

}


/* =====================================================
   NAVBAR HORIZONTAL MODE (FIXED)
===================================================== */

function initHorizontalNavbar(horizontalTween) {

  ScrollTrigger.create({
    trigger: ".horizontal-section",
    start: "top top",
    end: () => "+=" + document.querySelector(".horizontal-wrapper").offsetWidth,
    scrub: false,
    onEnter: () => {
      document.querySelector(".navbar")
        .classList.add("nav-horizontal");
    },
    onEnterBack: () => {
      document.querySelector(".navbar")
        .classList.add("nav-horizontal");
    },
    onLeave: () => {
      document.querySelector(".navbar")
        .classList.remove("nav-horizontal");
    },
    onLeaveBack: () => {
      document.querySelector(".navbar")
        .classList.remove("nav-horizontal");
    }
  });

}


/* =====================================================
   INIT
===================================================== */

function init() {

  const isMobile = window.innerWidth <= 768;

  initNavbar();
  initHeroIntro();
  initHeroParallax();

  if (!isMobile) {

    const horizontalTween = initHorizontal();

    initHorizontalNavbar(horizontalTween);
    initBackgroundTransitions(horizontalTween);
    initPanelDepth(horizontalTween);
    initPanelLinks(horizontalTween);

  }

  // Deze mogen altijd draaien
  initCurrencyFloat();
  initCurrencyChaos();
  initArcadeCards();
}

window.addEventListener("load", init);

window.addEventListener("resize", () => {
  location.reload(); // simpel & veilig voor layout switch
});
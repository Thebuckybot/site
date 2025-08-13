// index.js

document.addEventListener('DOMContentLoaded', () => {
  const sections = document.querySelectorAll('.intro-section, .feature-section, .final-cta-section');
  const currencyItems = document.querySelectorAll('.currency-item');

  // Intersection Observer for fade-in animations
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    rootMargin: '-50px', // Start de animatie iets eerder
    threshold: 0.2
  });

  sections.forEach(section => {
    observer.observe(section);
  });

  // Parallax effect for currency items
  window.addEventListener('scroll', () => {
    const scrollPosition = window.scrollY;
    
    currencyItems.forEach(item => {
      // Pas de parallax sterkte aan per item
      const speed = parseFloat(item.getAttribute('data-speed')) || 0.1;
      const yPos = scrollPosition * speed;
      item.style.transform = `translateY(${yPos}px)`;
    });
  });

  // Initiele posities voor currency items (voor parallax)
  currencyItems.forEach(item => {
    const speed = Math.random() * 0.2 + 0.05; // Random snelheid
    item.setAttribute('data-speed', speed);
  });
});
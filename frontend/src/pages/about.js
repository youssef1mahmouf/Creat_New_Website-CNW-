/** About page. */
export async function render(page) {
  page.innerHTML = `
    <section class="section">
      <div class="container">
        <h1 class="section-title" data-animate>About <span class="gradient-text">CNW</span></h1>
        <p class="section-sub" data-animate>CNW — Create New Website — is a modern full-stack web platform.</p>

        <div class="grid grid-2" data-stagger>
          <div class="card"><h3>Our Mission</h3><p>Make professional-grade websites accessible: combining robust engineering with striking visuals, so anyone can launch a secure, fast, beautiful site.</p></div>
          <div class="card"><h3>Technology</h3><p>Node.js + Express backend, MongoDB / JSON storage, JWT authentication with Argon2id hashing and AES-256-GCM encryption. Frontend built with Vite, Three.js, GSAP and Lenis.</p></div>
          <div class="card"><h3>What we build</h3><p>Formal corporate sites, immersive 3D experiences, cinematic animations and richly interactive applications — all responsive from mobile to desktop.</p></div>
          <div class="card"><h3>Privacy & Terms</h3><p>We never store raw card data, never expose secrets to the client, and log security-relevant events for transparency. Your data is encrypted at rest.</p></div>
        </div>
      </div>
    </section>`;
}

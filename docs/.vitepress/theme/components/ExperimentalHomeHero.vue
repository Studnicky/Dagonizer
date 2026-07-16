<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';

interface HeroImage { readonly src: string; readonly alt?: string }
interface HeroAction { readonly theme?: 'brand' | 'alt'; readonly text: string; readonly link: string }
interface Hero { readonly name?: string; readonly text?: string; readonly tagline?: string; readonly image?: HeroImage; readonly actions?: readonly HeroAction[] }
interface Feature { readonly icon?: string; readonly title: string; readonly details?: string; readonly link?: string }

const { frontmatter } = useData();
const hero = computed<Hero | null>(() => frontmatter.value['hero'] ?? null);
const features = computed<readonly Feature[]>(() => frontmatter.value['features'] ?? []);
function resolve(link: string): string { return /^https?:/.test(link) ? link : withBase(link); }
</script>

<template>
  <section v-if="hero" class="experimental-hero">
    <div class="experimental-copy">
      <p class="eyebrow"><span></span> Type-safe orchestration for the open web</p>
      <h1>{{ hero.name }}</h1>
      <p class="lead">{{ hero.text }}</p>
      <p class="summary">{{ hero.tagline }}</p>
      <div class="actions"><a v-for="action in hero.actions" :key="action.link" :href="resolve(action.link)" :class="['action', action.theme]">{{ action.text }}</a></div>
    </div>
    <div class="visual" aria-label="A DAG execution preview">
      <div class="orbit orbit-a"></div><div class="orbit orbit-b"></div>
      <div class="execution-card">
        <div class="card-line"><span>LIVE EXECUTION</span><b><i></i> READY</b></div>
        <div class="map"><span class="connector c1"></span><span class="connector c2"></span><span class="connector c3"></span><span class="node n1">IN</span><span class="node n2">ROUTE</span><span class="node n3">WORK</span><span class="node n4">OUT</span></div>
        <div class="card-line footer"><span>4 PLACEMENTS</span><span>CHECKPOINTED</span><span>0 ERRORS</span></div>
      </div>
      <img v-if="hero.image" :src="resolve(hero.image.src)" :alt="hero.image.alt ?? ''" />
    </div>
  </section>
  <div class="proof"><span>One runtime</span><span>Typed routing</span><span>Resumable by design</span><span>Runs in the browser</span></div>
  <section class="experimental-features">
    <component :is="feature.link ? 'a' : 'div'" v-for="feature in features" :key="feature.title" :href="feature.link ? resolve(feature.link) : undefined" class="feature">
      <strong>{{ feature.icon }} <span>{{ feature.title }}</span></strong><p>{{ feature.details }}</p>
    </component>
  </section>
</template>

<style scoped>
.experimental-hero { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(340px,.95fr); gap:clamp(2rem,7vw,7rem); align-items:center; min-height:min(690px,calc(100vh - 150px)); padding:clamp(2.5rem,7vw,6rem) 0; }
.experimental-copy h1 { color:var(--dagonizer-silver); font-family:var(--vp-font-family-display); font-size:clamp(4rem,9vw,8rem); letter-spacing:-.08em; line-height:.88; margin:0 0 1.3rem; }
.eyebrow,.lead,.summary,.actions { margin:0 0 1rem; }.eyebrow { color:var(--dagonizer-cyan); font:700 .68rem var(--vp-font-family-mono); letter-spacing:.12em; text-transform:uppercase; }.eyebrow span { display:inline-block; width:.45rem; height:.45rem; margin-right:.5rem; border-radius:50%; background:var(--dagonizer-cyan); box-shadow:0 0 18px var(--dagonizer-cyan); }.lead { color:var(--vp-c-text-1); font:600 clamp(1.35rem,2.4vw,2rem) var(--vp-font-family-display); letter-spacing:-.03em; }.summary { color:var(--vp-c-text-2); line-height:1.6; max-width:54ch; }.actions { display:flex; flex-wrap:wrap; gap:.6rem; padding-top:.5rem; }.action { border:1px solid var(--vp-c-divider); border-radius:999px; display:inline-block; padding:.8rem 1.35rem; text-decoration:none; transition:transform .2s,box-shadow .2s; }.action.brand { background:var(--dagonizer-cyan); color:var(--dagonizer-pearl); border-color:transparent; }.action:hover { transform:translateY(-2px); box-shadow:0 14px 30px -18px var(--dagonizer-cyan); }
.visual { min-height:400px; display:flex; align-items:center; justify-content:center; position:relative; }.execution-card { position:relative; z-index:2; width:100%; max-width:500px; padding:1.1rem; border:1px solid color-mix(in srgb,var(--dagonizer-cyan) 32%,var(--vp-c-divider)); border-radius:1.25rem; background:linear-gradient(145deg,var(--dagonizer-bg-elv),var(--dagonizer-bg)); box-shadow:0 30px 90px -30px rgba(34,232,255,.45); transform:rotate(2deg); }.card-line { display:flex; justify-content:space-between; color:var(--vp-c-text-3); font: .57rem var(--vp-font-family-mono); letter-spacing:.08em; }.card-line b { color:var(--dagonizer-cyan); font-weight:400; }.card-line i { display:inline-block; width:.35rem; height:.35rem; border-radius:50%; background:var(--dagonizer-cyan); }.map { height:285px; margin:1rem 0; position:relative; }.node { position:absolute; display:flex; align-items:center; justify-content:center; width:88px; height:54px; border:1px solid var(--dagonizer-cyan); border-radius:.55rem; background:var(--dagonizer-bg-elv); color:var(--vp-c-text-1); font:700 .62rem var(--vp-font-family-mono); }.n1{left:4%;top:42%}.n2{left:34%;top:14%;border-color:var(--dagonizer-brand2)}.n3{left:55%;top:57%;border-color:var(--dagonizer-brand3)}.n4{right:4%;top:26%}.connector { position:absolute; height:1px; transform-origin:left; width:28%; background:var(--dagonizer-cyan); }.c1{left:22%;top:49%;transform:rotate(-29deg)}.c2{left:51%;top:27%;transform:rotate(36deg)}.c3{left:22%;top:52%;transform:rotate(13deg);width:37%}.footer { border-top:1px solid var(--vp-c-divider); padding-top:.9rem; }.orbit { position:absolute; width:210px; height:460px; border:1px solid color-mix(in srgb,var(--dagonizer-brand2) 32%,transparent); border-radius:50%; transform:rotate(-24deg); }.orbit-a { animation:drift 9s ease-in-out infinite; }.orbit-b { width:260px; height:500px; transform:rotate(54deg); border-color:color-mix(in srgb,var(--dagonizer-cyan) 30%,transparent); }.visual img { position:absolute; z-index:3; width:clamp(72px,10vw,120px); right:-1.5rem; bottom:1.5rem; filter:drop-shadow(0 0 24px rgba(34,232,255,.35)); }
.proof { display:flex; flex-wrap:wrap; gap:1rem 2rem; color:var(--vp-c-text-3); font:.62rem var(--vp-font-family-mono); letter-spacing:.1em; text-transform:uppercase; margin:-.6rem 0 3rem; }.experimental-features { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:.8rem; margin-bottom:4rem; }.feature { padding:1.35rem 1.25rem; border:1px solid var(--vp-c-divider); border-radius:1rem; background:var(--dagonizer-surface-bg); text-decoration:none; transition:transform .25s,box-shadow .25s; }.feature:hover { transform:translateY(-4px); box-shadow:0 16px 35px -24px var(--dagonizer-cyan); }.feature strong { color:var(--dagonizer-cyan); font-family:var(--vp-font-family-display); }.feature p { color:var(--vp-c-text-2); font-size:.85rem; line-height:1.5; }.feature span { margin-left:.4rem; }
@keyframes drift { 0%,100%{transform:rotate(-24deg) scale(1)} 50%{transform:rotate(-16deg) scale(1.04)} } @media(prefers-reduced-motion:reduce){.orbit-a{animation:none}.action,.feature{transition:none}} @media(max-width:720px){.experimental-hero{grid-template-columns:1fr;min-height:auto;gap:.5rem}.visual{min-height:290px;order:-1}.map{height:210px}.node{width:70px;height:42px;font-size:.5rem}.visual img{right:0;width:72px}.proof{gap:.7rem;line-height:1.7}}
</style>

import { component$ } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
import { NavigationStateBridge } from "./components/navigation-state-bridge/navigation-state-bridge";
import { RouterHead } from "./components/router-head/router-head";
import { SiteShell } from "./components/site-shell/site-shell";
import "./global.css";

const prepaintScript =
  '(()=>{try{const t=localStorage.getItem("poc:theme");const w=localStorage.getItem("poc:wallpaper");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;if(w==="on"||w==="off")document.documentElement.dataset.wallpaper=w}catch{}})()';

export default component$(() => (
  <QwikCityProvider>
    <head>
      <meta charSet="utf-8" />
      <meta name="poc-build-id" content="qwik-generation-1" />
      <meta name="required-fonts" content="400,700" />
      <script dangerouslySetInnerHTML={prepaintScript} />
      <RouterHead />
    </head>
    <body lang="zh-CN">
      <a class="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div class="site-background" aria-hidden="true" />
      <div
        class="navigation-progress"
        data-navigation-progress
        data-active="false"
        aria-hidden="true"
      />
      <SiteShell />
      <NavigationStateBridge />
      <main id="main-content" class="page-frame">
        <RouterOutlet />
      </main>
    </body>
  </QwikCityProvider>
));

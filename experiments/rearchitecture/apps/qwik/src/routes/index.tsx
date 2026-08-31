import { component$ } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';

export default component$(() => (
  <section>
    <h1>全站重构垂直切片</h1>
    <p>
      <a href="/zh/blog/">进入中文博客切片</a>
    </p>
  </section>
));

export const head: DocumentHead = {
  title: '全站重构垂直切片',
};

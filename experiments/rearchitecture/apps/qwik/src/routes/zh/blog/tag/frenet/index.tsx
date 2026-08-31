import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { BlogPage } from "~/components/blog-page/blog-page";

export default component$(() => <BlogPage activeTag="Frenet" />);

export const head: DocumentHead = {
  title: "Frenet 标签 · SHAWN",
  meta: [
    {
      name: "description",
      content: "Frenet 标签的静态、可分享筛选结果",
    },
  ],
};

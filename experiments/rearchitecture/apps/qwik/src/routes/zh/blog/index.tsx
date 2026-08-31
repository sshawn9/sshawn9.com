import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { BlogPage } from "~/components/blog-page/blog-page";

export default component$(() => <BlogPage />);

export const head: DocumentHead = {
  title: "博客 · SHAWN",
  meta: [
    {
      name: "description",
      content: "全站重构候选的静态博客列表垂直切片",
    },
  ],
};

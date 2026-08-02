---
title: '功能示例：多版本文章'
description: '用于展示同一篇文章如何保留完整旧版本，同时默认提供结构完整的最新内容。'
publishedAt: 2024-06-18
revisedAt: 2026-07-31
revisionSummary: '简化读者端版本操作，支持任意两个版本之间的正文比较。'
tags:
  - { id: feature-demo, label: '功能示例' }
  - { id: blog, label: '博客' }
  - { id: astro, label: 'Astro' }
  - { id: markdown, label: 'Markdown' }
  - { id: content-management, label: '内容管理' }
  - { id: article-versions, label: '文章版本' }
  - { id: long-term-maintenance, label: '长期维护' }
  - { id: versioned-article, label: '多版本文章' }
  - { id: content-revision, label: '内容修订' }
  - { id: diff, label: '差异比较' }
  - { id: knowledge-management, label: '知识管理' }
  - { id: information-architecture, label: '信息架构' }
featured: true
---

> 这是当前最新的完整正文。旧版本仍然可以独立阅读。

## 背景

这篇示例文章用于说明一个需要长期维护的主题。

## 适用范围

下面的说明适合需要持续补充和修正的长寿命文章；一次性随笔通常不需要版本目录。

## 当前方案

当前包含三个步骤：

1. 首次发布时只建立文章目录和一份普通 Markdown 正文；
2. 发生首次实质变化时，把原文完整保存到 `v1/`，再创建完整的新版本；
3. 后续继续发布完整版本，文章入口默认选择编号最大的已发布版本。

每个版本目录都是一个自包含快照，其中包括该版本的语言文件和同目录图片。访问者可以阅读任意公开版本，也可以选择任意其他版本与正在阅读的版本比较。

## 结尾

读者默认得到结构完整的最新版；需要追溯时，再切换版本或比较两个版本。

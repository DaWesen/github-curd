import type { CardTheme, ThemeName } from './types';

export const themes: Record<ThemeName, CardTheme> = {
  'dreamy-galaxy': {
    name: 'dreamy-galaxy', label: '梦幻星河', background: '#101827', accent: '#2dd4bf', initialText: '#101827', title: '#f8fafc', muted: '#94a3b8', body: '#cbd5e1', divider: '#263449', panelBorder: '#2dd4bf', panelTitle: '#5eead4', chart: '#facc15', glow: '#2dd4bf',
  },
  'neon-cyber': {
    name: 'neon-cyber', label: '霓虹赛博', background: '#120b2e', accent: '#ce3dff', initialText: '#120b2e', title: '#ffffff', muted: '#c4b5fd', body: '#e9d5ff', divider: '#3b246b', panelBorder: '#df287a', panelTitle: '#ff3c91', chart: '#f7d63d', glow: '#ff2f88',
  },
  // 全部主题的统计卡片都走「设计稿底图 + 数据叠层」渲染器（底图见 images/ 与 src/theme-bgs.ts），
  // 这组颜色同时供叠层文字/渐变和语言卡片等自绘样式派生用
  'neon-starlight': {
    name: 'neon-starlight', label: '霓虹星空', background: '#00091d', accent: '#b04ef0', initialText: '#00091d', title: '#f8faff', muted: '#8b93c8', body: '#c3caf0', divider: '#232a55', panelBorder: '#6d4fd0', panelTitle: '#a78bfa', chart: '#f0abfc', glow: '#c084fc',
  },
  'aurora-nebula': {
    name: 'aurora-nebula', label: '星云极光', background: '#092a32', accent: '#a7f3d0', initialText: '#092a32', title: '#ecfeff', muted: '#7dd3fc', body: '#cffafe', divider: '#185866', panelBorder: '#5eead4', panelTitle: '#a7f3d0', chart: '#facc15', glow: '#5eead4',
  },
  'summer-lemon': {
    name: 'summer-lemon', label: '夏日柠檬', background: '#fffbea', accent: '#facc15', initialText: '#422006', title: '#422006', muted: '#a16207', body: '#713f12', divider: '#fde68a', panelBorder: '#eab308', panelTitle: '#ca8a04', chart: '#eab308', glow: '#f59e0b',
  },
  'sakura-story': {
    name: 'sakura-story', label: '樱花物语', background: '#3b1728', accent: '#f9a8d4', initialText: '#3b1728', title: '#fff1f2', muted: '#fda4af', body: '#ffe4e6', divider: '#6b2d46', panelBorder: '#f472b6', panelTitle: '#f9a8d4', chart: '#fbbf24', glow: '#ff9ecd',
  },
  'deep-sea-blue': {
    name: 'deep-sea-blue', label: '深海幽蓝', background: '#071b35', accent: '#38bdf8', initialText: '#071b35', title: '#eff6ff', muted: '#7dd3fc', body: '#dbeafe', divider: '#173b64', panelBorder: '#38bdf8', panelTitle: '#7dd3fc', chart: '#facc15', glow: '#38bdf8',
  },
  'amber-sun': {
    name: 'amber-sun', label: '琥珀暖阳', background: '#3a1d0b', accent: '#fbbf24', initialText: '#3a1d0b', title: '#fff7ed', muted: '#fdba74', body: '#ffedd5', divider: '#6b3515', panelBorder: '#f59e0b', panelTitle: '#fbbf24', chart: '#fde047', glow: '#fb923c',
  },
  'emerald-forest': {
    name: 'emerald-forest', label: '翡翠森林', background: '#08251b', accent: '#34d399', initialText: '#08251b', title: '#ecfdf5', muted: '#86efac', body: '#d1fae5', divider: '#18513b', panelBorder: '#34d399', panelTitle: '#6ee7b7', chart: '#facc15', glow: '#34d399',
  },
  'midnight-count': {
    name: 'midnight-count', label: '暗夜伯爵', background: '#171321', accent: '#c4b5fd', initialText: '#171321', title: '#faf5ff', muted: '#a78bfa', body: '#ede9fe', divider: '#3b2d50', panelBorder: '#a78bfa', panelTitle: '#c4b5fd', chart: '#fbbf24', glow: '#a78bfa',
  },
  'minimal-white': {
    name: 'minimal-white', label: '极简纯白', background: '#ffffff', accent: '#111827', initialText: '#ffffff', title: '#111827', muted: '#6b7280', body: '#374151', divider: '#e5e7eb', panelBorder: '#111827', panelTitle: '#111827', chart: '#eab308', glow: '#111827',
  },
  'polar-starlight': {
    name: 'polar-starlight', label: '极地星光', background: '#eaf6ff', accent: '#2563eb', initialText: '#ffffff', title: '#102a43', muted: '#526579', body: '#334e68', divider: '#c5e4f6', panelBorder: '#2563eb', panelTitle: '#1d4ed8', chart: '#eab308', glow: '#2563eb',
  },
  'blue-archive': {
    name: 'blue-archive', label: '蔚蓝档案', background: '#e8f2ff', accent: '#3b82f6', initialText: '#ffffff', title: '#1e40af', muted: '#6d87b8', body: '#3d5a8a', divider: '#c7ddf5', panelBorder: '#7db4f0', panelTitle: '#2563eb', chart: '#a78bfa', glow: '#38bdf8',
  },
};

export function getTheme(value: unknown): CardTheme {
  return typeof value === 'string' && value in themes
    ? themes[value as ThemeName]
    : themes['dreamy-galaxy'];
}
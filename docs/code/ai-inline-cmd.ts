// 斜杠命令定义
const SLASH_COMMANDS = [
    { command: '/polish', label: '润色文案', description: '润色并改善文案质量', icon: Type, instruction: 'Polish and improve this text, make it more professional and engaging. Keep the same language.' },
    { command: '/layout', label: '更换布局', description: '推荐更好的 Slidev 布局', icon: Layout, instruction: 'Change the Slidev layout of this slide. Suggest a better layout from: center, two-cols, image-right, cover, section. Output the full slide with new layout frontmatter.' },
    { command: '/fix', label: '修复语法', description: '修复语法和格式错误', icon: Bug, instruction: 'Fix any markdown syntax errors, typos, and formatting issues in this text.' },
    { command: '/convert', label: '转换格式', description: '智能转换内容格式', icon: RefreshCw, instruction: 'Convert the format of this content intelligently (e.g., list to table, paragraph to bullet points, or vice versa). Choose the best conversion.' },
    { command: '/image', label: 'AI 生图', description: '根据描述生成图片并插入', icon: ImageIcon, instruction: '' },
] as const;
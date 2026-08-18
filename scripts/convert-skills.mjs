/**
 * 将 SailFish 项目 skills/ 目录中的运维技能转换为 DSH skill 格式
 * （frontmatter: name 用目录名 kebab-case，description 取原描述），
 * 输出到本插件的 skills/ 目录。
 *
 * 用法：node scripts/convert-skills.mjs <SailFish根目录> [排除目录...]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = process.argv[2]
const exclude = new Set((process.argv.slice(3)).map((name) => name.replace(/\/+$/, '')))
const target = join(__dirname, '..', 'skills')

if (!source || !existsSync(source)) {
  console.error('用法：node scripts/convert-skills.mjs <SailFish根目录> [排除...]')
  process.exit(1)
}

const srcSkills = join(source, 'skills')
const dirs = readdirSync(srcSkills).filter((name) => {
  if (exclude.has(name)) return false
  return statSync(join(srcSkills, name)).isDirectory()
})

let count = 0
for (const dir of dirs) {
  const srcFile = join(srcSkills, dir, 'SKILL.md')
  if (!existsSync(srcFile)) continue
  const raw = readFileSync(srcFile, 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw)
  if (!match) continue
  const meta = {}
  for (const line of match[1].split('\n')) {
    const pair = /^([a-z-]+):\s*(.*)$/.exec(line)
    if (pair) meta[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim()
  }
  const description = (meta.description || meta.name || dir).replace(/"/g, "'")
  const body = raw.slice(match[0].length)
  const content = `---\nname: ${dir}\ndescription: "${description}"\n---\n${body}`
  const outDir = join(target, dir)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'SKILL.md'), content)
  count += 1
  console.log(`✓ ${dir}`)
}
console.log(`共转换 ${count} 个技能 → ${target}`)

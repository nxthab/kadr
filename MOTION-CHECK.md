# Проверка движения 2D в «Проверке» (ветка форка `feat/motion-check`)

Живёт только в форке `nxthab/kadr`. В апстрим (`HelpFreedom/kadr`) не отправлена — предложим, когда результат будет устойчивым.

## Что делает

Фрагмент объявляет движущиеся объекты в `inspect.tracks`, а `kadr_check` ловит то, чего не видно на контактном листе:

| причина | что это |
|---|---|
| `hardStart` | объект стоял и сразу тронулся на ≥ 30 % своей пиковой скорости (старт без разгона) |
| `hardStop` | за 1/30 с до остановки ещё ≥ 30 % пиковой скорости (остановка намертво) |
| `speedStep` | скорость скачком меняется на одном шаге внутри движения (склейка двух движений) |
| `strobe` | пик > 11 px за кадр таймлайна без смаза — note; > 60 px — warning |
| `readableFast` | читаемый текст едет быстрее ~170 px/с на 1080 px ширины |
| `jump` | видимый объект сместился за шаг больше чем на 15 % ширины кадра |

Пороги и откуда они взяты — `MOTION_LIMITS` в `src/engine/motionCheck.ts`.

```tsx
inspect: defineInspect({
  tracks: [{ name: 'плита', at: (t) => ({ x, y, scale, opacity }), size: [w, h], starts: 'offscreen' }]
})
```

## Файлы

**Новые (конфликтов при обновлениях не бывает):**
- `src/engine/motionCheck.ts` — весь анализ, чистая функция без импортов приложения.
- `scripts/check-motion.mjs` — самопроверка на синтетических движениях: `node scripts/check-motion.mjs`.
- `MOTION-CHECK.md` — эта памятка.

**Точки подключения в коде Kadr (переносить при каждом обновлении):**

| файл | где | что |
|---|---|---|
| `electron/fragment-kit/runtime.ts` | перед `export interface KadrInspect` и внутри него после `camera?` | `interface KadrTrack` + поле `tracks?: KadrTrack[]` |
| `electron/fragment-kit/player.tsx` | `runInspect()`, перед `const events =` и в `K.__kadrInspect = {…}` | семплирование треков на fps фрагмента + `tracks` в результате |
| `shared/types.ts` | `FragmentInspect`, после `camera:` | поле `tracks?` |
| `src/engine/checks.ts` | импорт, `CheckKind`, перед блоком «one main caption at a time» | `import { motionIssues }`, вид `'motion'`, одна строка цикла по клипам |
| `electron/mcp-bridge.cjs` | описание `kadr_check`, после `camera?` | одно предложение про `tracks` |

## Как обновлять, когда выходит новая версия Kadr

```bash
cd /Users/yujinkrul/CC_base/KADR-motion
git fetch origin
git rebase origin/main          # конфликт возможен только в 5 точках из таблицы
node scripts/check-motion.mjs   # все PASS
npm run typecheck
git push --force-with-lease fork feat/motion-check
```

Если в конфликте автор переписал место подключения — вставить ту же правку по смыслу (таблица выше), логику в `motionCheck.ts` не трогать.

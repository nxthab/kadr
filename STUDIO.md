# «Студия фрагмента» (форк `nxthab/kadr`, ветка `feat/studio`)

Один фрагмент в отдельном окне, без проекта (поэтому не тормозит):
- цикл A–B со звуком таймлайна под ним; скорость 0,25 / 0,5 / 1×; пробел — пуск, `[` `]` — поставить A/B, ← → — по кадру;
- крутилки — параметры фрагмента (`defineParams`): двигаются вживую, сохраняются в `params.json`, когда отпущены (тот же файл читают редактор и рендер);
- «→ в журнал» — текущие значения, участок и заметка дописываются строкой в `kadr-studio-journal.jsonl` рядом с проектом (без проекта — в папке данных Kadr). Журнал читает скилл моушн-графики.

Открыть: Инспектор фрагмента → «⟳ Студия: цикл и крутилки» (цикл = выделенный диапазон таймлайна, иначе первые 3 с клипа), или `kadrEditor.openStudio(clipId, a?, b?)` (через `kadr_eval`).

## Файлы

**Новые:** `electron/studio.ts` (окно, журнал), `electron/fragment-kit/studio.tsx` (страница), `src/engine/studioOpen.ts` (сборка цикла и звука), `STUDIO.md`.

**Точки подключения (переносить при обновлениях Kadr):**

| файл | что |
|---|---|
| `electron/fragments.ts` | `import STUDIO_TSX … ?raw`, `writeManaged(… 'studio.tsx', STUDIO_TSX)`, `export` у `ensureServer` |
| `electron/fragment-kit/player.tsx` | ветка `else if (params.get('studio') === '1')` перед `createRoot` |
| `electron/preload.ts` | `studioOpen`, `studioJournal` |
| `shared/types.ts` | те же два метода в API |
| `electron/main.ts` | `import { registerStudioIpc }` + вызов после `registerFragmentIpc` |
| `src/components/Inspector.tsx` | импорт `openStudio` + кнопка после «Сбросить» |
| `src/main.tsx` | импорт и `openStudio` в `kadrEditor` |

Каждая вставка помечена комментарием `fork: «Студия фрагмента»`.

# Форк nxthab/kadr — как он устроен

Автор Kadr — HelpFreedom/kadr (апстрим). Мы с ним не знакомы; наши правки живут здесь, пока результат не станет устойчиво хорошим — тогда предложим.

## Ветки

| ветка | что |
|---|---|
| `main` | зеркало main автора (автоматика перематывает её вперёд) |
| `yujin/build` | **наша сборка**, ветка по умолчанию; из неё работает Kadr (`CC_base/KADR-motion`) |
| `feat/motion-check` | проверка движения 2D — MOTION-CHECK.md |
| `feat/studio` | Студия фрагмента — STUDIO.md |
| `feat/skill-slow-in-out` | раздел «Motion that feels physical» в скилле kadr-motion |
| `fix/export-audio-placement`, `fix/packed-alpha-matte-colour` | исправления, отправленные автору (HelpFreedom/kadr #47, #48) |
| `sync/upstream-<sha>` | создаёт автоматика: обновление автора, примеренное к сборке |

## Слежение за обновлениями автора

`.github/workflows/upstream-watch.yml`, каждый день в 05:17 UTC (и вручную: Actions → upstream-watch → Run workflow):

1. Есть новые коммиты в main автора? Нет — тихо заканчивается.
2. Есть — сливает их с `yujin/build` в ветку `sync/upstream-<sha>`.
3. **Конфликт** → запуск падает, GitHub присылает письмо; в отчёте запуска — список файлов. Разбираем вместе по точкам подключения (MOTION-CHECK.md, STUDIO.md).
4. Без конфликта → проверка типов и `scripts/check-motion.mjs` → **PR в `yujin/build`** с заголовком «Kadr <sha>: ✅ совместимо» или «❌ проверки не прошли» и списком коммитов автора.
5. Слить — кнопкой в PR. Потом локально: `cd CC_base/KADR-motion && git pull`, перезапустить Kadr.

Ничего не сливается само.

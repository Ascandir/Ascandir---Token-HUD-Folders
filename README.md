# Ascandir - Token HUD Folders

Räumt das Token-HUD (das Menü, das beim Rechtsklick auf einen Token erscheint) auf: Der Spielleiter legt Ordner mit eigenem Symbol an und sortiert die Buttons hinein – auch die Buttons, die andere Module ins HUD einbauen.

## Installation

In Foundry unter **Add-on Modules → Install Module** diese Manifest-URL einfügen:

```
https://github.com/Ascandir/Ascandir---Token-HUD-Folders/releases/latest/download/module.json
```

Getestet mit Foundry v14.369.1 (ab v13 lauffähig). Funktioniert systemunabhängig, also auch mit dnd5e 6.0.6.

## So geht's

1. Modul in der Welt aktivieren.
2. Einmal per Rechtsklick das HUD eines Tokens öffnen – am besten bei einem Spielercharakter und einem NSC. Dabei merkt sich das Modul alle Buttons, die es dort findet.
3. **Spieleinstellungen → Ascandir - Token HUD Folders → Ordner einrichten** öffnen (nur Spielleiter).
4. Mit **Neuer Ordner** Ordner anlegen, Namen und Symbol vergeben und festlegen, ob der Ordner links oder rechts im HUD sitzt.
   - Symbol: entweder eine Font-Awesome-Klasse wie `fa-solid fa-dragon` (Vorschläge erscheinen beim Tippen) oder über den Bild-Button ein eigenes Bild.
5. Buttons aus der linken Liste per Drag & Drop in die Ordner ziehen. Doppelklick auf einen Button im Ordner legt ihn zurück.
6. **Speichern.**

Im Spiel erscheint statt der einzelnen Buttons ein Ordner-Symbol mit einer kleinen Zahl. Ein Klick klappt den Ordner auf, ein zweiter Klick (oder Rechtsklick) klappt ihn zu. Ordner bleiben offen, solange du am selben Token arbeitest.

## Einstellungen

- **Ordner auch für Spieler** – an: Spieler sehen die Ordner ebenfalls. Aus: nur der Spielleiter.
- **Buttons pro Zeile im Ordner** – wie breit ein aufgeklappter Ordner wird.

## Gut zu wissen

- Die Buttons werden nur verschoben, nicht nachgebaut. Deshalb funktionieren sie genau wie vorher.
- Ordner, deren Buttons bei einem Token gar nicht vorkommen (z. B. GM-Buttons bei Spielern), werden ausgeblendet.
- Wurde ein Modul deaktiviert, bleiben seine Buttons in der Liste. **Nicht zugeordnete vergessen** räumt die Liste auf.

# Abnehm-App

Gemeinsame Sprache für die fachlichen Konzepte der Abnehm-App.

## Konto und Person

**Konto**:
Die serverseitige Anmeldeidentität mit E-Mail, Passwort und Sitzungen. Ein Konto gehört genau einer Person, ist aber von deren Fachdaten getrennt.
_Avoid_: Nutzer, Profil

**Person**:
Der fachliche Akteur mit Anzeigename, Körperdaten, Zielen, Einträgen und Einstellungen.
_Avoid_: Konto, Nutzer

## Ziele und Onboarding

**Kalorienbudget**:
Die tägliche Kalorienmenge, die eine Person aufnehmen soll: Gesamtumsatz minus gewähltem Defizit, nie unter der Untergrenze.
_Avoid_: Kalorienziel, Kalorienlimit, Tagesbedarf

**Gesamtumsatz**:
Der geschätzte tägliche Energieverbrauch einer Person: Grundumsatz × Aktivitätsstufe.
_Avoid_: TDEE, Leistungsumsatz

**Aktivitätsstufe**:
Eine von drei Stufen der Alltagsaktivität, die den Grundumsatz zum Gesamtumsatz hochrechnet.
_Avoid_: PAL-Wert (nur intern), Aktivitätslevel

**Untergrenze**:
Der niedrigste zulässige Wert für das Kalorienbudget: 1200 kcal bzw. der Grundumsatz, je nachdem, was höher ist.
_Avoid_: Minimum, Mindestkalorien

**Tempo**:
Die gewählte Abnehmgeschwindigkeit, ausgedrückt als tägliches Defizit: „entspannt“ oder „zügiger“.
_Avoid_: Abnehmrate, Defizitstufe

**Haltemodus**:
Der Zustand ohne Defizit, in dem das Kalorienbudget dem Gesamtumsatz entspricht.
_Avoid_: Erhaltungsphase, Maintenance

**Zielgewicht**:
Das von einer Person selbst gesetzte Gewicht, das sie erreichen möchte.
_Avoid_: Wunschgewicht, Endgewicht

**Budgetvorschlag**:
Eine aus dem Gewichtstrend abgeleitete Anpassung des Kalorienbudgets, die erst nach Bestätigung gilt.
_Avoid_: Auto-Anpassung, Nachjustierung

**Zielversion**:
Eine ab einem lokalen Kalendertag geltende Fassung der persönlichen Ziele. Änderungen erzeugen eine neue Fassung, statt frühere Zielwerte zu überschreiben.
_Avoid_: Zielstand, Zieleinstellung

**Sicherheits-Check**:
Die Onboarding-Fragen, die bei einem Risiko (Schwangerschaft/Stillzeit, Essstörung, Untergewicht) den Haltemodus statt eines Defizits erzwingen.
_Avoid_: Gesundheitsfragebogen, Ausschlusskriterien

## Momo und Wochenplan

**Baustein**:
Eine Art von Tagesziel aus einem festen Katalog (Ernährung erfasst, Im Kalorienbudget, Wasserziel, Sporteinheit, Gewogen).
_Avoid_: Zieltyp, Aufgabe

**Tagesziel**:
Ein für einen lokalen Kalendertag festgeschriebener Baustein auf einem der drei Momo-Plätze einer Person. Es bewahrt die an diesem Tag geltenden Zielwerte; spätere Änderungen wirken nicht rückwirkend.
_Avoid_: Quest, Mission, Challenge

**Tageszielerfüllung**:
Das dauerhaft festgehaltene erstmalige Erfüllen eines Tagesziels. Spätere Korrekturen können den aktuellen Zielzustand ändern, nehmen aber weder Tageszielerfüllung noch daraus entstandene Belohnungen zurück.
_Avoid_: aktueller Zielzustand, Energiegutschrift

**Wochenplan**:
Die persönliche Belegung der drei Momo-Plätze für jeden Wochentag. Änderungen gelten ab dem nächsten lokalen Kalendertag.
_Avoid_: Trainingsplan, Zeitplan

**Sporttag**:
Ein im Wochenplan markierter Wochentag, an dem der Baustein Sporteinheit gilt.
_Avoid_: Trainingstag

**Wiegetag**:
Ein im Wochenplan markierter Wochentag, an dem der Baustein Gewogen gilt.
_Avoid_: Messtag

## Momos Insel

**Insel**:
Die gemeinsame Spielwelt des Paars, in der Momo lebt; entsteht beim Schlüpfen und wird beim Entkoppeln zusammen mit Momo archiviert.
_Avoid_: Welt, Garten, Spielfeld

**Energie**:
Die persönliche Spielwährung einer Person, die nur aus erfüllten Tageszielen und dem Tagesbonus entsteht, nie verfällt und nicht übertragbar ist.
_Avoid_: Punkte, Münzen, Coins

**Rolle**:
Die beim Schlüpfen gewählte Zuständigkeit einer Person auf der Insel: Bauen (Häuser, Wege, Brücken) oder Natur (Pflanzen, Bäume, Tiere); tauschbar nur mit Zustimmung beider.
_Avoid_: Klasse, Beruf

**Eigene Ecke**:
Der Inselbereich einer Person, den sie unabhängig von ihrer Rolle allein frei gestalten kann.
_Avoid_: Privatbereich, Inselhälfte

**Energiebuchung**:
Ein unveränderlicher Eintrag in der Energie-Buchungsliste einer Person: eine Gutschrift für ein Tagesziel bzw. den Tagesbonus oder eine Ausgabe für Bauen, Aufwerten oder Einzahlen; der Kontostand ist die Summe aller Buchungen. Eine Gutschrift bleibt bestehen, auch wenn das Tagesziel durch eine Korrektur wieder unerfüllt ist.
_Avoid_: Transaktion, Punktestand

**Tagesende-Gutschrift**:
Die Energie-Gutschrift für ein Tagesziel, das sich erst nach Ablauf des Kalendertags entscheiden lässt (Im Kalorienbudget), und für den Tagesbonus an solchen Tagen; alle übrigen Tagesziele werden sofort beim Erfüllen gutgeschrieben.
_Avoid_: Nachgutschrift, Abrechnung

**Lager**:
Der persönliche Vorrat einer Person an Inselobjekten, die gerade auf keinem Feld stehen, z. B. erhaltene Deko oder ein bei einem Sync-Konflikt verdrängtes Objekt; Platzieren aus dem Lager kostet keine Energie.
_Avoid_: Inventar, Rucksack

**Bauplan**:
Ein durch Levelaufstieg, Gebiet oder Insel-Ereignis freigeschaltetes Objekt, das mit Energie gebaut werden kann.
_Avoid_: Rezept, Item

**Feld**:
Ein Platz auf der Insel, auf dem genau ein gebautes Objekt steht; jede Person hat eine begrenzte Zahl, die mit jedem Gebiet wächst.
_Avoid_: Kachel, Tile, Slot

**Gebiet**:
Ein Inselbereich, den eine große Form von Momo freischaltet; bringt neue Felder und Entdeckungs-Baupläne. Nach dem siebten Gebiet folgt alle sechs Level ein weiteres.
_Avoid_: Zone, Region, Welt

**Aufwerten**:
Ein gebautes Objekt mit Energie auf die nächste Stufe heben (höchstens Stufe 3), ohne ein neues Feld zu belegen; zählt wie Bauen für den Levelbalken.
_Avoid_: Upgrade, Ausbauen

**Gemeinschaftsprojekt**:
Ein großes Inselprojekt mit je einem Bau- und einem Natur-Anteil, die jede Person mit eigener Energie ohne Frist füllt; fertig, wenn beide Anteile voll sind.
_Avoid_: Challenge, Gruppenquest

**Insel-Ereignis**:
Ein freiwilliges, nicht verfallendes Vorkommnis auf der Insel – Besucher mit Wunsch, Momos Wunsch, Inselwetter oder Entdeckung –, das Baupläne, Deko oder ein Momo-Accessoire bringt.
_Avoid_: Event, Quest, Mission, Fundstück

**Wunsch**:
Ein Insel-Ereignis, das erst belohnt wird, wenn ein bestimmtes Objekt gebaut oder etwas in die eigene Ecke gestellt wurde; gehört genau einer Person, die es allein erfüllen kann, und bleibt ohne Frist offen.
_Avoid_: Auftrag, Aufgabe

**Deko**:
Ein Inselobjekt aus einem Insel-Ereignis, das ohne Energie platziert wird und als einziges Inselobjekt an den Partner verschenkt werden kann.
_Avoid_: Item, Geschenk

**Jahreszeiten-Deko**:
Deko aus dem Inselwetter einer Jahreszeit; kommt jedes Jahr wieder, sodass Verpasstes nachgeholt werden kann.
_Avoid_: Saison-Item, Limited Edition

**Level**:
Momos gemeinsame Entwicklungsstufe; steigt, wenn beide Personen ihre Hälfte des Levelbalkens mit selbst verbauter Energie gefüllt haben, und schaltet Baupläne und Gebiete frei.
_Avoid_: XP, Erfahrungspunkte, Stufe

## Partner

**Partner**:
Die eine andere Person, mit der ein Konto gekoppelt ist und Momo teilt.
_Avoid_: Freund, Kontakt, Mitglied

**Kopplung**:
Die archivierungsfähige Verbindung genau zweier Personen, Voraussetzung dafür, dass Momo schlüpft. Nach einer Entkopplung reaktiviert eine erneute Kopplung derselben Personen ihre bisherige Insel; mit einer anderen Person entsteht eine neue Kopplung und Insel.
_Avoid_: Verknüpfung, Pairing, Freundschaft

**Einladungscode**:
Ein kurzlebiger, einmal verwendbarer Code, mit dem eine Person eine Kopplung herstellt.
_Avoid_: Einladungslink, Partnercode

**Partnerfreigabe**:
Die Einstellung einer Person, ob ihr Partner für einen Gesundheitsbereich eine Zusammenfassung sehen darf. Mahlzeitenfotos werden davon unabhängig freigegeben.
_Avoid_: Berechtigung, Sichtbarkeit, Zugriffsstufe

**Zusammenfassung**:
Die für den Partner sichtbare verdichtete Darstellung eines Gesundheitsbereichs ohne einzelne Einträge; beim Gewicht umfasst sie nur Trend und Veränderung, nie den absoluten Wert.
_Avoid_: Detailansicht, Rohdaten

## Ernährungserfassung

**Tagesprotokoll**:
Die nach Mahlzeiten gegliederte Übersicht aller Ernährungseinträge eines Kalendertags.
_Avoid_: Tagebuch, Tagesansicht

**Mahlzeit**:
Eine Kategorie des Tagesprotokolls: Frühstück, Mittagessen, Abendessen oder Snacks.
_Avoid_: Essenszeit, Mahlzeitenart

**Ernährungseintrag**:
Ein einer Mahlzeit zugeordnetes Lebensmittel oder Gericht mit erfasster Menge und Nährwerten.
_Avoid_: Kalorieneintrag, Essen

**Eigenes Lebensmittel**:
Ein vom Nutzer angelegter oder korrigierter Nährwertdatensatz, der unabhängig von den externen Quelldaten gespeichert wird.
_Avoid_: Benutzerprodukt, korrigiertes Produkt

**Fotoentwurf**:
Eine noch nicht bestätigte, kurzlebige KI-Schätzung, die eine fotografierte Mahlzeit in einzeln änderbare Bestandteile mit Mengen und Nährwerten zerlegt.
_Avoid_: KI-Eintrag, Fotoergebnis

**Mahlzeitenfoto**:
Das nach Bestätigung eines Fotoentwurfs aufbewahrte Bild. Es kann mehreren daraus erzeugten Ernährungseinträgen zugeordnet und unabhängig von ihnen gelöscht werden.
_Avoid_: Fotoentwurf, Ernährungseintrag

**Lebensmittelfavorit**:
Ein als häufig verwendet markiertes einzelnes Lebensmittel. Er folgt Änderungen am referenzierten Lebensmittel, bleibt durch seine letzte bekannte Fassung aber auch ohne die Quelle nutzbar.
_Avoid_: Favorit, sofern dadurch eine Zusammenstellung gemeint sein könnte

**Mahlzeitenfavorit**:
Eine benannte, wiederverwendbare Zusammenstellung mehrerer Lebensmittel mit ihren üblichen Mengen. Seine Bestandteile folgen Änderungen an den referenzierten Lebensmitteln, bleiben durch ihre letzte bekannte Fassung aber auch ohne die Quellen nutzbar. Das Übernehmen erzeugt unabhängige Ernährungseinträge und verändert den Favoriten nicht.
_Avoid_: Rezept, Vorlage

"""Build the published quote data with grouped furigana annotations."""

import json
import re
from pathlib import Path

from pykakasi import kakasi


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_PATH = DATA_DIR / "quotes.json"

HAN_RE = re.compile(r"[\u3400-\u9fff々]")
KANA_RE = re.compile(r"[\u3040-\u30ff]")


def to_hiragana(value: str) -> str:
    return "".join(chr(ord(char) - 0x60) if "\u30a1" <= char <= "\u30f6" else char for char in value)


def annotate_token(token: dict) -> str:
    original = token["orig"]
    reading = token["hira"]
    if not HAN_RE.search(original):
        return original

    parts = []
    index = 0
    reading_index = 0
    while index < len(original):
        han_match = HAN_RE.match(original, index)
        if not han_match:
            kana_match = KANA_RE.match(original, index)
            if kana_match:
                kana = to_hiragana(kana_match.group(0))
                if reading.startswith(kana, reading_index):
                    reading_index += len(kana)
                else:
                    return original
                parts.append(kana_match.group(0))
                index = kana_match.end()
                continue
            parts.append(original[index])
            index += 1
            continue

        han_end = han_match.end()
        while han_end < len(original) and HAN_RE.match(original, han_end):
            han_end += 1

        next_index = han_end
        while next_index < len(original) and not HAN_RE.match(original, next_index):
            next_index += 1
        following = original[han_end:next_index]

        if following and all(KANA_RE.fullmatch(char) for char in following):
            target = to_hiragana(following)
            target_index = reading.rfind(target, reading_index + 1)
            if target_index < reading_index:
                return original
            han_reading = reading[reading_index:target_index]
            if not han_reading:
                return original
            reading_index = target_index
        else:
            han_reading = reading[reading_index:]
            reading_index = len(reading)

        if not han_reading:
            return original
        parts.append(original[index:han_end] + "[" + han_reading + "]")
        index = han_end

    return "".join(parts)


def annotate(text: str, converter) -> str:
    return "".join(annotate_token(token) for token in converter.convert(text))


def main() -> None:
    existing = json.loads((DATA_DIR / "quotes.json").read_text(encoding="utf-8"))
    existing = [quote for quote in existing if quote.get("id", "").startswith("q") and int(quote["id"][1:]) <= 100]
    additional = json.loads((DATA_DIR / "additional-quotes.json").read_text(encoding="utf-8"))
    converter = kakasi()
    built = existing + [
        {key: value for key, value in quote.items() if key != "text"} | {"ruby": annotate(quote["text"], converter)}
        for quote in additional
    ]
    OUTPUT_PATH.write_text(json.dumps(built, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"built {len(built)} quotes -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

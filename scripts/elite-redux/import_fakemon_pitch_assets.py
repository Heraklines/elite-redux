#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2024-2026 Pagefault Games
# SPDX-License-Identifier: AGPL-3.0-only

"""Normalize the approved fakemon-pitch art into ER asset directories.

This importer intentionally keeps source selection explicit. The originals stay in
the local asset library; only game-ready PNGs are written to the er-assets checkout.
Tier 2/3 and tier 4 are produced by the repository's established generators after
this script creates normal, tier-1 shiny, and icon images.
"""

from __future__ import annotations

import argparse
import colorsys
import json
from collections import Counter, deque
from pathlib import Path

from PIL import Image


SPRITE_SIZE = (96, 96)
ICON_FRAME_SIZE = (32, 32)


def rel(path: str) -> Path:
    return Path(path.replace("/", "\\"))


GDRIVE = rel("sources/google-drive-2026-08-20/originals")


SOURCES: dict[str, dict[str, object]] = {
    "tremburr": {
        "front": GDRIVE / rel("1bvuNP4NiMsHjRZ_v1iGpuqCXRtGpo_59/TIMBURR.png"),
        "back": GDRIVE / rel("14N6jgbdHvf8KF8z9foyV1foIisE_05d4/TIMBURR BACK.png"),
        "icon": GDRIVE / rel("14DMUMU2tS92mhyo5K_fM_VYgrj0m8uf2/TIMBURR MENU.png"),
    },
    "gurdurur": {
        "front": GDRIVE / rel("14lJ9LbrHck5Py9E7v-Y3y25BKnsJeQUH/GURDURR.png"),
        "back": GDRIVE / rel("1Cq4BTd8DmIqVTDgwggvFKjR95XFjecpF/GURDURR BACK.png"),
        "icon": GDRIVE / rel("1x9p9qRmAZe71r18KftxSiqiVkRML75Ca/GURDURR MENU.png"),
    },
    "conkapitator": {
        "front": GDRIVE / rel("1WUSA2_xNFKz2EXgSHjAn8uIOuqNK50M3/CONKELDUR.png"),
        "back": GDRIVE / rel("183ZQZGUkhBatYcZnI1WWijWRHjM8F9Da/CONKELDUR BACK.png"),
        "icon": GDRIVE / rel("1am6oA-UQHamDLuQ9uCmeN6PcrlYDR3mf/CONKELDUR MENU.png"),
    },
    "dippowdown": {
        "front": GDRIVE / rel("1vYe0g2iVIkuZSUbW_fI1gq3v9G8Km3q4/HIPPOWDON_1.png"),
        "back": GDRIVE / rel("1LylV-54X6pOquINRg7dXsIf71JPyZ4K8/HIPPOWDON_1.png"),
        "icon": GDRIVE / rel("1kT3dGFl3YzSYYUzeTf_T8eNQ-TSj7cNE/HIPPOWDON_1.png"),
    },
    "justyke": {
        "front": GDRIVE / rel("1c3CuW4vswPe6-QGPhHtU88w9i358eO1j/justyke.png"),
        "back": GDRIVE / rel("1L-iTu3y9H67Hl5H0OyFUzFeRVoKuUTgJ/justyke (1).png"),
    },
    "equilibra": {
        "front": GDRIVE / rel("1H4ypUuiCrcdv75RiBPUQ4gVeH92cAXQe/equilibra.png"),
        "back": GDRIVE / rel("1F1SyAnwqHAsAgWnb-UpgRRW0u9uAuQho/equilibra (1).png"),
    },
    "ledian_mega": {
        "front": GDRIVE / rel("1sxz2SZruE9uWp8h_RDCzcJU_hQJJXz9G/ledian mega.webp"),
        "back": GDRIVE / rel("1SeOyKjU_T1Qg75UK_TvdbGqHxvij-RWH/ledian mega1.webp"),
        "icon": GDRIVE / rel("1MQOhSSVS3GxRU1Lw-1sCEoJBpyHTQyCI/ledian mega icon.webp"),
    },
    "lickilicking": {
        "sheet": GDRIVE / rel("1L27RON9MR_e1CiFl8n-j9hyJWt0weERV/lickilicking.jpg"),
        "icon": GDRIVE / rel("1Dtywm3Imttzq_bjaSEE-dg5NsixJmo6A/icon77.png"),
        "checker_sheet": True,
    },
    "mangling_blade": {
        "front": GDRIVE / rel("1nEnW3gvvb31tfn3EQi_4GsZMxBhysYZG/cobriviron__covirakion_or_cobaliridion__by_imoicon_dl10wo4.png"),
        "back": GDRIVE / rel("1OAoZNaOomJKaPv8d60FS1ErzUixIVANM/mangling blade.png"),
    },
    "octillery_redux": {
        "front": GDRIVE / rel("1gggtI7ebOFjs0IpXGqKjxFNEl-gtTPQW/Spaceworld_Octillary_Front.png"),
        "back": GDRIVE / rel("1kHd97rya2xp9QKLJRe7zRNX8KhL73wmN/Spaceworld_Octillary_Back.png"),
    },
    "snuglett": {
        "front": GDRIVE / rel("1Ko8-efzxyMjhJQxZnQ7Rpieg8zHXVsbS/Regional_Diglett_Front.png"),
        "back": GDRIVE / rel("15QWyM88RNm2qivUMuBZbOFm_s_yVyqTn/Regional_Diglett_Back.png"),
    },
    "snugtrio": {
        "front": GDRIVE / rel("1Cp2K4Y-gf-Gk01RG8PHQCrwf76BsbpJ2/Regional_Dugtrio_Front.png"),
        "back": GDRIVE / rel("1Dd18xG19QQgpemyLgEuVueV1F1zRbfaa/Regional_Dugtrio_Back.png"),
    },
    "pentasnug": {
        "front": GDRIVE / rel("1NR-Bb6cQ_5bhsN_No9N0cb41PkgGpBkg/Pentasnug Front.png"),
        "back": GDRIVE / rel("15aNC7Ay1LT-huG7ryL6aPeJJ2UJ5sF6R/Pentasnug Back.png"),
    },
    "pyrothon": {
        "front": GDRIVE / rel("18ERAvcOC7UouG17VUONoFO8j00XTjMU_/006.png"),
        "back": GDRIVE / rel("1LPffj-v-YhU2d1ePOb3S0jsT38cvMoYg/006 (1).png"),
    },
    "rampardos_mega": {
        "front": GDRIVE / rel("11L3snE6TnKTRoBGPzgZoCLcwX68cs1zR/23.png"),
        "back": GDRIVE / rel("13UBrthbD5ITONiKa3dhkeqm3jxId7AAO/23B.png"),
        "icon": GDRIVE / rel("1924SAOXnq1nNRaLuEhyffIpDDIKsucMl/icon23.png"),
    },
    "ponyta_redux": {
        "front": GDRIVE / rel("1-DVe3L-4ilgbRdV-L2xqPS7rxoLyOJjs/PONYTA.png"),
        "back": GDRIVE / rel("1KT8vTceU2kNYVlhKHkzkeic9DIuCelxn/PONYTA BACK.png"),
        "icon": GDRIVE / rel("1ECTwfWxWsI4p-YPrsPlJnbc4cBeYBKef/PONYTA MENU.png"),
    },
    "rapidash_redux": {
        "front": GDRIVE / rel("1Wo3IlIvH0EqcPgOOcACFIyoysnqBfoot/RAPIDASH.png"),
        "back": GDRIVE / rel("1jEKl6HXiGToF9WtsCezQ5WQ1UNkJHGNX/RAPIDASH BACK.png"),
        "icon": GDRIVE / rel("19jYFSHLk3LTPGmU4utvguOk0hjWCruFt/RAPIDASH (1).png"),
    },
    "voltriever": {
        "front": GDRIVE / rel("1t7hnHR2YfJ3rTWx1g4vFlJT2Dh4Hd1pP/cyberdog.png"),
        "back": GDRIVE / rel("1X1c6-3O-OgONazCF_Z7WQpDA7Sb2HAP0/cyberdog (1).png"),
    },
    "wailbore": {
        "front": GDRIVE / rel("1wmTtmMTwfBBfX3XnL-UR4z6gHoiSU8od/WAILORD_1.png"),
        "back": GDRIVE / rel("1SuLlORt4O44j3zcsYNz75ZiWv_sb4zYf/WAILORD_1.png"),
        "icon": GDRIVE / rel("1Se_-pLi-lbMoIpbVCYB0j3NCEiLSa-2r/WAILORD_1.png"),
    },
    "xatu_mega": {
        "front": GDRIVE / rel("1ecVQReZzT98di7ETvBlD__sdm5PUY9dw/Mega Xatu.png"),
        "back": GDRIVE / rel("1He7s8tPBG_skxm250nv6wrLY-jyof0Qn/xatu mega back mine.png"),
    },
    # 2026 pitch-expansion sources. The existing 70026 Egoelk slug is
    # deliberately replaced in place; no second egoelk_pitch directory.
    "egoelk": {
        "front": GDRIVE / rel("1T4hRMcHxirnKk80U1M_BjFV8V5Oq1zLK/(stantler) Egoelk.png"),
        "back": GDRIVE / rel("1twCPEWTQn4lk3qEVdWB-0MZQ6jmGHeIe/(stantler) EgoelkB.png"),
    },
    "mishamanus": {
        "front": GDRIVE / rel("1hril7J9wLZW9jK7B_EKlsYTxlRFyQlVX/429_1f.png"),
        "back": GDRIVE / rel("1cMSVItYR4atMk3KaUDoa7IIf7UpxXemH/429_1b.png"),
    },
    "iron_stream": {
        "front": GDRIVE / rel("1zqusY_jILwg-OAkRllZtBgt3SDpwagZs/iron_stream_by_imoicon_dl1iki5.png"),
        "back": GDRIVE / rel("13JOYO_D4nGVd5EBE2qTLNIIxPCIoBjmP/iron stream back.png"),
        "icon": GDRIVE / rel("1GPQDiGL7_hvq29ausVYQO9E-3FQkX3xk/iron stream icon.png"),
    },
    "slabberigus": {
        "front": GDRIVE / rel("1P4Dt-2lfgzfoH1GCXEay4XuTIR0jkmIe/slabberigus.png"),
        "back": GDRIVE / rel("1-el96lkNzHjqtxBCnLqxeITOl1-I0lR4/slabberigus1.png"),
        "icon": GDRIVE / rel("17wrRORriqqBZy84xycX_oQzBivmxHgLH/slabberigusicon.png"),
    },
    "tagela": {
        "front": GDRIVE / rel("1M61fDsH2hr1j3Kkd1drLU5pgTY--5g5U/TANGELA.png"),
        "back": GDRIVE / rel("1G97_nx9QWeSxEBSnbYGdEPrhddSG75oH/TANGELA BACK.png"),
    },
    "intangrowth": {
        "front": GDRIVE / rel("11JOBGSlEiYGXzSNy66laq9OIl8PPYRBU/TANGROWTH.png"),
        "back": GDRIVE / rel("1hX_ILAkrNEI_874eEgbjJPaYEA0pWEIc/TANGROWTH BACK.png"),
    },
    "calyrex_chariot_mega": {
        "front": GDRIVE / rel("1tnbGcB1dUCVJWde1I-_CQVAIXU_WiAQP/calyrexfront.png"),
        "back": GDRIVE / rel("1EPTa86vbMZPH1dGQjfY0yqxdsd4EUhS-/calyrexback.png"),
    },
    "barbaracle_mega_y": {
        "front": GDRIVE / rel("1ZzqLcQJ9MeVHdWwdHVk-bQe2d1CM-T7b/Mega Barbaracle.png"),
        "back": GDRIVE / rel("16TlxPoEMRs8WPm2zoYWiVlb90Hv8STd-/Mega Barbaracle_back.png"),
    },
    "uxie_corrupted": {
        "front": GDRIVE / rel("1x3ojztqzcQM0Am_kG6zODSkYpCYOsvJm/480_1f.png"),
        "back": GDRIVE / rel("11FtS4LC7ICN-ARf9OAWg1evzCfY43q59/480_1b.png"),
    },
}


SHEETS: dict[str, dict[str, object]] = {
    "cryogonal_mega": {
        "front": GDRIVE / rel("143w7OCVtjKTEiTSEyGs19TR4ZKqSE50K/dmh6m2m-3f24f753-3726-48e6-bd6b-ae0efd703244.png"),
        "back": GDRIVE / rel("1Vn5vNDcD5Vt32O-KSlW1sg5k5u05exE9/dmh6m2m-97618713-13de-4e23-a608-6927ddb37c00.png"),
        "layout": "horizontal_pair",
    },
    "reuniclus_mega_x": {
        "front": GDRIVE / rel("1K7HaZ0T2BeZGum-nLDjSJ75VENCoV2pl/dmgym03-c77b9d62-c62b-496c-8755-6a8277dfdc14.png"),
        "back": GDRIVE / rel("1s3ybQ2v1fH1Drm5Qroh1r-i2L_EvDLz2/dmgym03-0bf80bc4-af82-4b20-950c-de6b12a264eb.png"),
        "layout": "horizontal_pair",
    },
    "power_plant": {
        "front": GDRIVE / rel("1NU8stkMXzzbb1b2WgfChZX9ItxXiV1p3/edited IronWill or IronPlant.png"),
        "layout": "power_plant",
    },
    "zangoose_mega": {
        "front": GDRIVE / rel("1EFZ215CW1qsvdd2XRxUXpqQDcjZKJV88/dmiyyys-a7379144-3ff0-40ad-8ef3-7f35d544befd.png"),
        "layout": "zangoose",
    },
    "jirachi_mega": {
        "front": GDRIVE / rel("15xbL66c8a2A6mNw05FxHyqQTEvCdzxRX/dkmezld-ec030404-3c8c-45ec-b29b-14a21a5dfae7.png"),
        "back": GDRIVE / rel("1CIeYgMiAfmLwYq_SydoK9w0eUUtYJMzm/dkmezld-a6eb05d6-2c0c-42cc-81c2-79b961c127b0.png"),
        "icon": GDRIVE / rel("1V50CpkyqoLA5DCIAlosYPrYGUnwMcQlC/dkmezld-133f0e99-04fe-444d-8be2-f68c4a088c32.png"),
        "layout": "single_large",
    },
    "falinks_convergent": {
        "front": GDRIVE / rel("1es9QT9jNxN9h5HFIe4rXN96BWiygqZgj/FALINKS_1.png"),
        "back": GDRIVE / rel("1c-poD2qpL-8XxS08kkWi3NACOr_gy-wW/FALINKS_1.png"),
        "layout": "explicit_pair",
    },
    "hypno_mega": {
        "front": GDRIVE / rel("1cYJkQ_uXucFJI0EDiTk1N76zTBCuv7yp/HYPNO_1.png"),
        "back": GDRIVE / rel("1piYrTwtPxkHNawZTu5_xMUQ4JOl0_4U4/HYPNO_1.png"),
        "layout": "explicit_pair",
    },
    "raichu_alolan_mega_male": {
        "front": GDRIVE / rel("12sTZsyn5TJtyOsZYLCAsRispOCn4tkEx/image_by_lennybitao_dmo3ert.png"),
        "back": GDRIVE / rel("1LyNF5wGwu8l8daogFzHoOYdRC6hFgNxP/image_by_lennybitao_dmo3e0q.png"),
        "layout": "gender_view_pair",
        "gender_index": 0,
    },
    "raichu_alolan_mega_female": {
        "front": GDRIVE / rel("12sTZsyn5TJtyOsZYLCAsRispOCn4tkEx/image_by_lennybitao_dmo3ert.png"),
        "back": GDRIVE / rel("1LyNF5wGwu8l8daogFzHoOYdRC6hFgNxP/image_by_lennybitao_dmo3e0q.png"),
        "layout": "gender_view_pair",
        "gender_index": 1,
        "refresh_derived_icon": True,
    },
    "lilligant_verdant": {
        "front": GDRIVE / rel("1mI_44Vv7qZZI6js4HFQDJDkNisWYaVix/verdan_lilligant___moon_priestess_by_kfweagz_dmjs9lf-fullview.png"),
        "layout": "lilligant_panel",
    },
    "lilligant_verdant_mega": {
        "front": GDRIVE / rel("1mI_44Vv7qZZI6js4HFQDJDkNisWYaVix/verdan_lilligant___moon_priestess_by_kfweagz_dmjs9lf-fullview.png"),
        "layout": "lilligant_panel_mega",
    },
}

# BerNerd's approved Discord roster. Paths are relative to the separately
# supplied Bum archive; keeping this table distinct prevents the private local
# source library path from leaking into the repository.
BERNERD_SOURCES: dict[str, dict[str, object]] = {
    "golurk_mega_y": {"front": rel("Mega Golurk/mega golurk.png"), "back": rel("Mega Golurk/mega golurk back.PNG"), "shiny": rel("Mega Golurk/mega golurk shiny.png"), "shiny_back": rel("Mega Golurk/mega golurk shiny back.PNG"), "icon": rel("Mega Golurk/icon m golurk.PNG")},
    "skuntank_mega": {"front": rel("Mega Skuntank/m skuntank.png"), "back": rel("Mega Skuntank/m skuntank back.PNG"), "shiny": rel("Mega Skuntank/m skuntank shiny.png"), "shiny_back": rel("Mega Skuntank/m skuntank shiny back.PNG"), "icon": rel("Mega Skuntank/icon skunt.PNG")},
    "dodrio_mega": {"front": rel("Mega Dodrio/mega dodrio.png"), "back": rel("Mega Dodrio/mega dodrio back.PNG"), "shiny": rel("Mega Dodrio/mega dodrio shiny.png"), "shiny_back": rel("Mega Dodrio/mega dodrio shiny back.PNG"), "icon": rel("Mega Dodrio/icon dodrio.png")},
    "vantarrow": {"front": rel("Evo Charcadet (Dark)/darkcharcadetevo.png"), "back": rel("Evo Charcadet (Dark)/darkcharcadetevo back.PNG"), "shiny": rel("Evo Charcadet (Dark)/darkcharcadetevo sh1.png"), "shiny_back": rel("Evo Charcadet (Dark)/darkcharcadetevo sh1 back.PNG"), "icon": rel("Evo Charcadet (Dark)/icon charcadet.png")},
    "chromighty": {"front": rel("FREE Evo Charcadet (steel-fire)/chromighty.png"), "back": rel("FREE Evo Charcadet (steel-fire)/chromighty back.PNG"), "shiny": rel("FREE Evo Charcadet (steel-fire)/chromighty shiny.png"), "shiny_back": rel("FREE Evo Charcadet (steel-fire)/chromighty shiny back.PNG"), "icon": rel("FREE Evo Charcadet (steel-fire)/icon cromighty.PNG")},
    "temporal_skull": {"front": rel("Evo marowak/Evo Marowak kanto/marowak evo.png"), "back": rel("Evo marowak/Evo Marowak kanto/marowak evo back.PNG"), "shiny": rel("Evo marowak/Evo Marowak kanto/marowak evo shiny.png"), "shiny_back": rel("Evo marowak/Evo Marowak kanto/marowak evo shiny back.PNG"), "icon": rel("Evo marowak/Evo Marowak kanto/icon marowak evo.png")},
    "quakersby": {"front": rel("Evo Diggersby/quakersby.png"), "back": rel("Evo Diggersby/quakersby back.PNG"), "shiny": rel("Evo Diggersby/quakersby shiny.png"), "shiny_back": rel("Evo Diggersby/quakersby shiny back.PNG"), "icon": rel("Evo Diggersby/quakersby icon.png")},
    "guzzlord_m": {"front": rel("Ultra Guzzlord (black hole)/blackhole guzzlord.png"), "back": rel("Ultra Guzzlord (black hole)/blackhole guzzlord back.PNG"), "shiny": rel("Ultra Guzzlord (black hole)/blackhole guzzlord sh1.png"), "shiny_back": rel("Ultra Guzzlord (black hole)/blackhole guzzlord sh1 back.PNG"), "icon": rel("Ultra Guzzlord (black hole)/icon guzzlo.PNG")},
    "pyukumuku_mega": {"front": rel("Mega (tag) Pyukumuku/mega pyukumuku.png"), "back": rel("Mega (tag) Pyukumuku/mega pyukumuku back.PNG"), "shiny": rel("Mega (tag) Pyukumuku/mega pyukumuku shiny.png"), "shiny_back": rel("Mega (tag) Pyukumuku/mega pyukumuku shiny back.PNG"), "icon": rel("Mega (tag) Pyukumuku/icon mega pyukum.PNG")},
    "rowlet_partner": {"front": rel("Primal Rowlet oisin/oisin.png"), "back": rel("Primal Rowlet oisin/oisin back.PNG"), "shiny": rel("Primal Rowlet oisin/oisin shiy.png"), "shiny_back": rel("Primal Rowlet oisin/oisin shiy back.PNG"), "icon": rel("Primal Rowlet oisin/oisin icon.PNG")},
    "onix_partner": {"front": rel("Mega Carbonix/Front.png"), "back": rel("Mega Carbonix/mega carbonix back.PNG"), "icon": rel("Mega Carbonix/mega carbonix icon.png"), "palette_transfer": True},
    "gimmighoul_partner": {"front": rel("Evo Gimmighoul chest/gimmighoul evo.png"), "back": rel("Evo Gimmighoul chest/gimmighoul evo back.PNG"), "shiny": rel("Evo Gimmighoul chest/gimmighoul evo sh.png"), "shiny_back": rel("Evo Gimmighoul chest/gimmighoul evo sh back.PNG"), "icon": rel("Evo Gimmighoul chest/icon gimmighoul e.PNG")},
}


def remove_border_background(image: Image.Image) -> Image.Image:
    """Drop a solid/checker backdrop without touching immutable sources."""
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    border: list[tuple[int, int, int]] = []
    for x in range(width):
        for y in (0, height - 1):
            r, g, b, a = pixels[x, y]
            if a:
                border.append((r, g, b))
    for y in range(height):
        for x in (0, width - 1):
            r, g, b, a = pixels[x, y]
            if a:
                border.append((r, g, b))
    if not border:
        return image
    background = Counter(border).most_common(1)[0][0]
    queue: deque[tuple[int, int]] = deque()
    seen: set[tuple[int, int]] = set()

    def is_background(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        if not a:
            return False
        return sum((channel - base) ** 2 for channel, base in zip((r, g, b), background)) <= 52**2

    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height) or not is_background(x, y):
            continue
        seen.add((x, y))
        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return image


def open_rgba(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(path)
    return remove_border_background(Image.open(path).convert("RGBA"))


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    return image.getchannel("A").getbbox()


def normalize_sprite(image: Image.Image, size: tuple[int, int] = SPRITE_SIZE, margin: int = 4) -> Image.Image:
    image = image.convert("RGBA")
    bbox = alpha_bbox(image)
    if not bbox:
        return Image.new("RGBA", size)
    image = image.crop(bbox)
    scale = min((size[0] - margin * 2) / image.width, (size[1] - margin * 2) / image.height, 1.0)
    if image.width > size[0] - margin * 2 or image.height > size[1] - margin * 2:
        scale = min((size[0] - margin * 2) / image.width, (size[1] - margin * 2) / image.height)
    elif max(image.width, image.height) < 72:
        integer_scale = max(1, int(min((size[0] - margin * 2) / image.width, (size[1] - margin * 2) / image.height)))
        scale = integer_scale
    target = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    if target != image.size:
        image = image.resize(target, Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", size)
    x = (size[0] - image.width) // 2
    y = size[1] - margin - image.height
    canvas.alpha_composite(image, (x, y))
    return canvas


def remove_checker_background(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    seen: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()

    def is_checker(x: int, y: int) -> bool:
        r, g, b, _ = pixels[x, y]
        return max(r, g, b) - min(r, g, b) <= 38 and (r + g + b) / 3 >= 145

    for x in range(width):
        for y in (0, height - 1):
            if is_checker(x, y):
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_checker(x, y):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not is_checker(x, y):
            continue
        seen.add((x, y))
        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                queue.append((nx, ny))
    return image


def hue_shift(image: Image.Image, degrees: float = 155.0) -> Image.Image:
    image = image.convert("RGBA")
    out = Image.new("RGBA", image.size)
    source = image.load()
    target = out.load()
    shift = degrees / 360.0
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = source[x, y]
            if a == 0:
                target[x, y] = (0, 0, 0, 0)
                continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if s < 0.13 or l < 0.08 or l > 0.94:
                target[x, y] = (r, g, b, a)
                continue
            nr, ng, nb = colorsys.hls_to_rgb((h + shift) % 1.0, l, s)
            target[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return out


def palette_transfer(source_front: Image.Image, target_front: Image.Image, source_back: Image.Image) -> Image.Image:
    """Transfer the approved front palette onto the matching back geometry."""
    source_front = source_front.convert("RGBA")
    target_front = target_front.convert("RGBA")
    source_back = source_back.convert("RGBA")
    if source_front.size != target_front.size:
        raise ValueError("palette transfer front/reference dimensions must match")
    votes: dict[tuple[int, int, int], Counter[tuple[int, int, int]]] = {}
    for source, target in zip(source_front.getdata(), target_front.getdata()):
        if source[3] and target[3]:
            votes.setdefault(source[:3], Counter())[target[:3]] += 1
    mapping = {source: choices.most_common(1)[0][0] for source, choices in votes.items()}
    out = Image.new("RGBA", source_back.size)
    for index, pixel in enumerate(source_back.getdata()):
        if pixel[3] == 0:
            out.putpixel((index % out.width, index // out.width), pixel)
            continue
        replacement = mapping.get(pixel[:3], pixel[:3])
        out.putpixel((index % out.width, index // out.width), (*replacement, pixel[3]))
    return out


def normalize_icon(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    width, height = image.size
    frames: list[Image.Image]
    if width == height * 2:
        frames = [image.crop((0, 0, height, height)), image.crop((height, 0, width, height))]
    elif height == width * 2:
        frames = [image.crop((0, 0, width, width)), image.crop((0, width, width, height))]
    elif width >= 2 * height:
        frame_width = height if width % height == 0 else width // 2
        frames = [
            image.crop((index * frame_width, 0, min((index + 1) * frame_width, width), height))
            for index in range(min(2, width // frame_width))
        ]
    else:
        frames = [image, image.copy()]

    normalized: list[Image.Image] = []
    for frame in frames[:2]:
        frame = normalize_sprite(frame, ICON_FRAME_SIZE, 2)
        normalized.append(frame)
    if len(normalized) == 1:
        normalized.append(normalized[0].copy())
    icon = Image.new("RGBA", (32, 64))
    icon.alpha_composite(normalized[0], (0, 0))
    icon.alpha_composite(normalized[1], (0, 32))
    return icon


def derived_icon(front: Image.Image) -> Image.Image:
    return normalize_icon(front)


def write_single_frame_atlas(path: Path, image_name: str, size: tuple[int, int], frame_size: tuple[int, int] | None = None) -> None:
    """Write the one-frame TexturePacker metadata consumed by the game loader."""
    frame_width, frame_height = frame_size or size
    atlas = {
        "textures": [
            {
                "image": image_name,
                "format": "RGBA8888",
                "size": {"w": size[0], "h": size[1]},
                "scale": 1,
                "frames": [
                    {
                        "filename": "0001.png",
                        "rotated": False,
                        "trimmed": False,
                        "sourceSize": {"w": frame_width, "h": frame_height},
                        "spriteSourceSize": {"x": 0, "y": 0, "w": frame_width, "h": frame_height},
                        "frame": {"x": 0, "y": 0, "w": frame_width, "h": frame_height},
                    }
                ],
            }
        ],
        "meta": {"app": "er-build/generate-er-sprite-atlases", "version": "1.0"},
    }
    path.write_text(json.dumps(atlas, indent=2) + "\n", encoding="utf-8")


def save_species(
    output_root: Path,
    slug: str,
    images: dict[str, Image.Image],
    icon: Image.Image | None = None,
    refresh_derived_icon: bool = False,
) -> None:
    directory = output_root / slug
    directory.mkdir(parents=True, exist_ok=True)
    if "front" not in images:
        raise ValueError(f"{slug}: approved front source is missing")
    front = normalize_sprite(images["front"])
    has_back_source = "back" in images
    back_path = directory / "back.png"
    if has_back_source:
        back = normalize_sprite(images["back"])
    elif back_path.is_file():
        back = Image.open(back_path).convert("RGBA")
    else:
        raise FileNotFoundError(f"{slug}: approved back source and retained back output are both missing")
    shiny = normalize_sprite(images.get("shiny", hue_shift(front)))
    shiny_2 = normalize_sprite(images.get("shiny_2", hue_shift(shiny, 120.0)))
    shiny_3 = normalize_sprite(images.get("shiny_3", hue_shift(shiny, 240.0)))
    front.save(directory / "front.png")
    shiny.save(directory / "shiny.png")
    shiny_2.save(directory / "shiny-2.png")
    shiny_3.save(directory / "shiny-3.png")
    for basename in ("front", "shiny", "shiny-2", "shiny-3"):
        write_single_frame_atlas(directory / f"{basename}.json", f"{basename}.png", SPRITE_SIZE)
    if has_back_source:
        shiny_back = normalize_sprite(images.get("shiny_back", hue_shift(back)))
        shiny_back_2 = normalize_sprite(images.get("shiny_back_2", hue_shift(shiny_back, 120.0)))
        shiny_back_3 = normalize_sprite(images.get("shiny_back_3", hue_shift(shiny_back, 240.0)))
        back.save(back_path)
        shiny_back.save(directory / "shiny-back.png")
        shiny_back_2.save(directory / "shiny-back-2.png")
        shiny_back_3.save(directory / "shiny-back-3.png")
        for basename in ("back", "shiny-back", "shiny-back-2", "shiny-back-3"):
            write_single_frame_atlas(directory / f"{basename}.json", f"{basename}.png", SPRITE_SIZE)
    icon_path = directory / "icon.png"
    if icon is not None:
        normalize_icon(icon).save(icon_path)
    elif refresh_derived_icon or not icon_path.is_file():
        derived_icon(front).save(icon_path)
    write_single_frame_atlas(directory / "icon.json", "icon.png", (32, 64), ICON_FRAME_SIZE)

def load_regular(library_root: Path, spec: dict[str, object]) -> tuple[dict[str, Image.Image], Image.Image | None]:
    if "sheet" in spec:
        sheet = remove_checker_background(open_rgba(library_root / spec["sheet"]))
        half = sheet.width // 2
        content_bottom = min(sheet.height, 610)
        images = {
            "front": sheet.crop((0, 0, half, content_bottom)),
            "back": sheet.crop((half, 0, sheet.width, content_bottom)),
        }
    else:
        images = {"front": open_rgba(library_root / spec["front"])}
        if "back" in spec:
            images["back"] = open_rgba(library_root / spec["back"])
    if "shiny" in spec:
        images["shiny"] = open_rgba(library_root / spec["shiny"])
    if "shiny_back" in spec:
        images["shiny_back"] = open_rgba(library_root / spec["shiny_back"])
    icon = open_rgba(library_root / spec["icon"]) if "icon" in spec else None
    return images, icon


def crop_horizontal_pair(image: Image.Image) -> tuple[Image.Image, Image.Image]:
    half = image.width // 2
    return image.crop((0, 0, half, image.height)), image.crop((half, 0, image.width, image.height))


def crop_zangoose(image: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image, Image.Image]:
    # The right half is concept art; the four sprite panels occupy the left 376 px.
    x_mid = 188
    y_mid = image.height // 2
    return (
        image.crop((0, 0, x_mid, y_mid)),
        image.crop((x_mid, 0, x_mid * 2, y_mid)),
        image.crop((0, y_mid, x_mid, image.height)),
        image.crop((x_mid, y_mid, x_mid * 2, image.height)),
    )
def load_sheet(library_root: Path, spec: dict[str, object]) -> tuple[dict[str, Image.Image], Image.Image | None]:
    layout = spec["layout"]
    if layout == "explicit_pair":
        return {
            "front": open_rgba(library_root / spec["front"]),
            "back": open_rgba(library_root / spec["back"]),
        }, None
    if layout == "view_pair":
        front, back = crop_horizontal_pair(open_rgba(library_root / spec["front"]))
        return {"front": front, "back": back}, None
    if layout == "gender_view_pair":
        # The first sheet contains male/female FRONT views; the second contains
        # male/female BACK views. They are not per-gender front/back sheets.
        front_sheet = open_rgba(library_root / spec["front"])
        back_sheet = open_rgba(library_root / spec["back"])
        gender_index = int(spec["gender_index"])
        if gender_index not in (0, 1):
            raise ValueError(f"gender_view_pair index must be 0 or 1, got {gender_index}")
        if front_sheet.size != back_sheet.size or front_sheet.width % 2 != 0:
            raise ValueError("gender_view_pair sheets must have matching dimensions and two equal columns")
        front_views = crop_horizontal_pair(front_sheet)
        back_views = crop_horizontal_pair(back_sheet)
        return {"front": front_views[gender_index], "back": back_views[gender_index]}, None
    if layout == "lilligant_panel_mega":
        sheet = open_rgba(library_root / spec["front"])
        return {
            "front": sheet.crop((649, 3, 779, 157)),
            "back": sheet.crop((649, 166, 779, 315)),
            "shiny": sheet.crop((809, 3, 939, 157)),
            "shiny_back": sheet.crop((809, 166, 939, 315)),
        }, None
    if layout == "lilligant_panel":
        sheet = open_rgba(library_root / spec["front"])
        return {
            "front": sheet.crop((12, 3, 139, 157)),
            "back": sheet.crop((15, 166, 138, 315)),
            "shiny": sheet.crop((172, 3, 298, 157)),
            "shiny_back": sheet.crop((175, 166, 298, 315)),
        }, None
    if layout == "horizontal_pair":
        front, shiny = crop_horizontal_pair(open_rgba(library_root / spec["front"]))
        back, shiny_back = crop_horizontal_pair(open_rgba(library_root / spec["back"]))
        return {"front": front, "back": back, "shiny": shiny, "shiny_back": shiny_back}, None
    if layout == "power_plant":
        sheet = open_rgba(library_root / spec["front"])
        half_w, half_h = sheet.width // 2, sheet.height // 2
        return {
            "front": sheet.crop((0, 0, half_w, half_h - 2)),
            "back": sheet.crop((half_w, 0, sheet.width, half_h - 2)),
        }, None
    if layout == "zangoose":
        front, back, shiny, shiny_back = crop_zangoose(open_rgba(library_root / spec["front"]))
        return {"front": front, "back": back, "shiny": shiny, "shiny_back": shiny_back}, None
    if layout == "single_large":
        images = {
            "front": open_rgba(library_root / spec["front"]),
            "back": open_rgba(library_root / spec["back"]),
        }
        icon_sheet = open_rgba(library_root / spec["icon"])
        icon, _ = crop_horizontal_pair(icon_sheet)
        return images, icon
    raise ValueError(f"Unknown sheet layout: {layout}")
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--library-root", type=Path, required=True)
    parser.add_argument("--assets-root", type=Path, required=True)
    parser.add_argument("--bernerd-root", type=Path)
    parser.add_argument("--onix-partner-front", type=Path)
    parser.add_argument(
        "--slugs",
        help="Comma-separated approved output slugs; omit only for the legacy full import.",
    )
    args = parser.parse_args()
    output_root = args.assets_root / "images" / "pokemon" / "elite-redux"
    selected = {slug.strip() for slug in args.slugs.split(",")} if args.slugs else None

    for slug, spec in SOURCES.items():
        if selected is not None and slug not in selected:
            continue
        images, icon = load_regular(args.library_root, spec)
        save_species(output_root, slug, images, icon, bool(spec.get("refresh_derived_icon", False)))
        print(f"imported {slug}")
    for slug, spec in SHEETS.items():
        if selected is not None and slug not in selected:
            continue
        images, icon = load_sheet(args.library_root, spec)
        save_species(output_root, slug, images, icon, bool(spec.get("refresh_derived_icon", False)))
        print(f"imported {slug}")

    if args.bernerd_root is not None:
        for slug, spec in BERNERD_SOURCES.items():
            if selected is not None and slug not in selected:
                continue
            images, icon = load_regular(args.bernerd_root, spec)
            if bool(spec.get("palette_transfer", False)):
                if args.onix_partner_front is None:
                    raise ValueError("--onix-partner-front is required for the approved Onix Partner recolor")
                target_front = open_rgba(args.onix_partner_front)
                images["back"] = palette_transfer(images["front"], target_front, images["back"])
                images["front"] = target_front
                icon = None
            save_species(output_root, slug, images, icon, True)
            print(f"imported {slug}")

    if selected is not None and "power_plant_live_current" not in selected:
        return
    # Live Current occupies the lower two panels of Power Plant's source sheet.
    power_spec = SHEETS["power_plant"]
    power_sheet = open_rgba(args.library_root / power_spec["front"])
    half_w, half_h = power_sheet.width // 2, power_sheet.height // 2
    live_images = {
        "front": power_sheet.crop((0, half_h + 2, half_w, power_sheet.height)),
        "back": power_sheet.crop((half_w, half_h + 2, power_sheet.width, power_sheet.height)),
    }
    save_species(output_root, "power_plant_live_current", live_images)
    print("imported power_plant_live_current")


if __name__ == "__main__":
    main()

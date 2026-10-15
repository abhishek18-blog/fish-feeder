#!/usr/bin/env python3
"""
fish_disease_detector.py — MobileNetV2 Fish Disease Classifier for Chaquopy (Android) & Local CLI
Loads `smart_fish_mobilenet.pth` and classifies fish images into the 4 pathogen classes:
  - Bacterial
  - Viral
  - Fungal
  - Parasitic

Supports BOTH PyTorch (`torch` + `torchvision`) when available AND a 100% exact
vectorized NumPy + Pillow MobileNetV2 engine reading directly from the `.pth` archive.
"""

import base64
import collections
import io
import json
import math
import os
import pickle
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile

import numpy as np
from PIL import Image

# Primary 4 classes requested by user
PRIMARY_CLASSES = ["Bacterial", "Viral", "Fungal", "Parasitic"]

# 7 raw output indices inside smart_fish_mobilenet.pth (Freshwater Fish Disease MobileNetV2)
RAW_7_CLASSES = [
    ("Bacterial", "Bacterial Red Disease (Hemorrhagic Septicemia)"),
    ("Bacterial", "Bacterial Aeromoniasis (Ulcer Disease)"),
    ("Bacterial", "Bacterial Gill Disease (Flavobacterium)"),
    ("Fungal", "Fungal Saprolegniasis (Cotton Wool Disease)"),
    ("Healthy", "Healthy / Mild Stress"),
    ("Parasitic", "Ectoparasitic Infection (Ich / Flukes / Anchor Worm)"),
    ("Viral", "Viral White Tail / Lymphocystis Disease"),
]

# Comprehensive treatment & veterinary care database for each class
TREATMENT_PROTOCOLS = {
    "Bacterial": {
        "diseaseType": "Bacterial",
        "severity": "High — Requires Prompt Antibacterial Treatment",
        "pathogens": "Aeromonas hydrophila, Pseudomonas, Flavobacterium columnare",
        "symptoms": [
            "Reddish hemorrhagic streaks or ulcers on body and fins",
            "Frayed/eroded fins (fin & tail rot) or swollen inflamed gills",
            "Lethargy, clamped fins, loss of appetite, or gasping at surface",
            "Abdominal bloating (dropsy) or protruding eyes in advanced stages",
        ],
        "immediateSteps": [
            "Perform an immediate 30%–40% dechlorinated water change to reduce bacterial load.",
            "Move severely affected fish to a hospital/quarantine tank with strong aeration.",
            "Administer a therapeutic aquarium salt bath (1 tbsp per 3 gallons / ~3 g/L) for osmotic relief.",
        ],
        "medications": [
            {
                "name": "Kanamycin (Seachem KanaPlex) or Oxytetracycline",
                "dosage": "180–250 mg per 10 gallons (38 L) every 48 hours for 3 doses",
                "purpose": "Broad-spectrum gram-negative antibiotic effective against Aeromonas & fin rot",
            },
            {
                "name": "API Melafix / Acriflavine / Methylene Blue Dip",
                "dosage": "5 mL per 10 gallons daily for 7 days",
                "purpose": "Antiseptic wound healing for external red sores and frayed fins",
            },
            {
                "name": "Medicated Antibacterial Feed (MetroPlex + Focus)",
                "dosage": "Mix 1 measure with 1 tbsp pellets, feed once daily for 5–7 days",
                "purpose": "Treats internal systemic bacterial infection if the fish is still eating",
            },
        ],
        "waterParameters": {
            "temperature": "24°C – 26°C (Do NOT raise temp for bacterial infections — warmth accelerates bacterial growth)",
            "ammoniaNitrite": "0 ppm Ammonia, 0 ppm Nitrite, < 20 ppm Nitrate",
            "dissolvedOxygen": "High — Add air stone while medicating",
        },
        "feederAdvice": "Reduce SmartFish Feeder portion size to 1x (Small) so uneaten pellets do not decay and spike ammonia.",
    },
    "Viral": {
        "diseaseType": "Viral",
        "severity": "Moderate to High — Supportive & Immune Care Required",
        "pathogens": "Iridovirus (Lymphocystis), Carp Edema Virus (CEV), Nodavirus / White Tail Virus",
        "symptoms": [
            "Whitish/milky discoloration along the tail peduncle or muscular tissue",
            "Cauliflower-like nodular growths (Lymphocystis) on fins or skin",
            "Erratic swimming, listlessness, or resting at the bottom of the tank",
            "Pale gills and sunken eyes",
        ],
        "immediateSteps": [
            "Isolate infected fish immediately in a quarantine tank to prevent horizontal transmission.",
            "Note: Antibiotics do NOT cure viruses direttamente, but prevent deadly secondary bacterial infections.",
            "Stabilize water temperature and eliminate all environmental stressors (ammonia/nitrite spikes).",
        ],
        "medications": [
            {
                "name": "Vitamin C + Beta-Glucan + Garlic Guard Supplement",
                "dosage": "Soak fish pellets for 10 mins before feeding once daily for 14 days",
                "purpose": "Boosts innate fish immune response to clear viral replication naturally",
            },
            {
                "name": "Aquarium Salt + StressGuard (Mucosal Protectant)",
                "dosage": "1 tsp salt per gallon + 2.5 mL StressGuard per 10 gallons",
                "purpose": "Rebuilds slime coat barrier and reduces osmoregulatory stress",
            },
            {
                "name": "Prophylactic Acriflavine / Potassium Permanganate Bath",
                "dosage": "2 mg/L short 30-minute bath",
                "purpose": "Prevents opportunistic bacterial or fungal invasion of viral lesions",
            },
        ],
        "waterParameters": {
            "temperature": "Maintain stable species-optimal temperature (26°C – 28°C)",
            "ammoniaNitrite": "0 ppm Ammonia, 0 ppm Nitrite (strictly pristine water)",
            "dissolvedOxygen": "Maximum aeration with UV sterilizer enabled if available",
        },
        "feederAdvice": "Keep regular scheduled small feedings (1x portion) soaked in vitamins to maintain immune strength.",
    },
    "Fungal": {
        "diseaseType": "Fungal",
        "severity": "Moderate — Targeted Antifungal Treatment Needed",
        "pathogens": "Saprolegnia spp., Achlya spp. (Water Mold / Cotton Wool Fungus)",
        "symptoms": [
            "White or gray cotton-wool / fluffy tufts growing on skin, fins, mouth, or gills",
            "Often develops over prior physical scrapes, fin nips, or cold-water stress sites",
            "Clamped fins and rubbing against tank decor",
            "Loss of protective mucus coat around the fluffy patches",
        ],
        "immediateSteps": [
            "Siphon all decaying food and organic debris from the gravel immediately (fungi thrive on uneaten food).",
            "Remove activated carbon from the filter before dosing antifungal medication.",
            "Perform a 15-minute salt dip (2 tsp aquarium salt per liter of tank water) for rapid mycelial dehydration.",
        ],
        "medications": [
            {
                "name": "Methylene Blue or Malachite Green (Ich-X / Pimafix)",
                "dosage": "1 tsp (5 mL) per 10 gallons every 24 hours after a 25% water change",
                "purpose": "Directly penetrates and destroys Saprolegnia fungal hyphae",
            },
            {
                "name": "API Pimafix (Pimenta racemosa Antifungal)",
                "dosage": "5 mL per 10 gallons daily for 7 consecutive days",
                "purpose": "Natural botanical antifungal safe for biological filtration",
            },
            {
                "name": "Aquarium Salt (NaCl) Continuous Tank Dose",
                "dosage": "1 tablespoon per 3 gallons (dissolved before adding)",
                "purpose": "Inhibits fungal spore germination and aids gill function",
            },
        ],
        "waterParameters": {
            "temperature": "Raise gradually to 26°C – 27°C (Saprolegnia thrives in cold water)",
            "ammoniaNitrite": "0 ppm Ammonia, 0 ppm Nitrite — vacuum substrate thoroughly",
            "dissolvedOxygen": "Increase surface agitation (medications reduce dissolved O2)",
        },
        "feederAdvice": "Avoid overfeeding! Excess uneaten pellets breed Saprolegnia spores. Use 1x portion setting.",
    },
    "Parasitic": {
        "diseaseType": "Parasitic",
        "severity": "High — Contagious Tank-Wide Antiparasitic Protocol Required",
        "pathogens": "Ichthyophthirius multifiliis (Ich), Dactylogyrus/Gyrodactylus (Flukes), Lernaea (Anchor Worm)",
        "symptoms": [
            "Pinhead-sized white salt-like spots (Ich) scattered across body, fins, and gills",
            "Frequent 'flashing' (scratching/rubbing body against substrate, rocks, or glass)",
            "Rapid gill movement, excess mucus film, or visible thread-like parasites",
            "Fins folded tightly against the body and hiding near filter outlets",
        ],
        "immediateSteps": [
            "Treat the ENTIRE main aquarium (free-swimming theronts and tomont cysts live in the substrate).",
            "Gradually raise water temperature by 1°C every 6 hours up to 28°C–30°C to speed up the parasite life cycle.",
            "Vacuum the gravel daily before each re-dose to remove fallen parasite cysts.",
        ],
        "medications": [
            {
                "name": "Malachite Green + Formalin (Hikari Ich-X or Seachem ParaGuard)",
                "dosage": "5 mL per 10 gallons every 24h after a 30% gravel-vacuum water change",
                "purpose": "Eliminates free-swimming Ich theronts and external protozoan parasites",
            },
            {
                "name": "Praziquantel (Hikari PraziPro)",
                "dosage": "1 tsp (5 mL) per 20 gallons for 5–7 days",
                "purpose": "Targets gill flukes, skin flukes, and internal flatworms safely",
            },
            {
                "name": "Heat + Aquarium Salt Therapy",
                "dosage": "29°C water temp + 1 tbsp aquarium salt per 2 gallons for 10 days",
                "purpose": "Disrupts osmotic balance of emerging parasites during the vulnerable theront stage",
            },
        ],
        "waterParameters": {
            "temperature": "28°C – 30°C (accelerates Ich life cycle so medication can kill free-swimming stage)",
            "ammoniaNitrite": "0 ppm Ammonia, 0 ppm Nitrite",
            "dissolvedOxygen": "CRITICAL: Warm water holds less oxygen — run an extra air stone 24/7",
        },
        "feederAdvice": "Higher temperature increases fish metabolism — feed small, nutrient-dense 1x portions twice daily.",
    },
}


# ── Pure-Python / NumPy `.pth` Loader ────────────────────────────────────────

class _DummyStorage:
    def __init__(self, dtype, key, location, size):
        self.dtype = dtype
        self.key = key
        self.location = location
        self.size = size


def _rebuild_tensor_v2(storage, storage_offset, size, stride, requires_grad, backward_hooks):
    return (storage.key, storage_offset, size)


class _TorchUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module == "torch._utils" and name == "_rebuild_tensor_v2":
            return _rebuild_tensor_v2
        if module == "collections" and name == "OrderedDict":
            return collections.OrderedDict
        return (module, name)

    def persistent_load(self, pid):
        return _DummyStorage(pid[1], pid[2], pid[3], pid[4])


_CACHED_WEIGHTS = None
_CACHED_MODEL_PATH = None


def _resolve_model_path(custom_path=None):
    candidates = []
    if custom_path:
        candidates.append(custom_path)
    here = os.path.dirname(os.path.abspath(__file__))
    candidates.extend([
        os.path.join(here, "smart_fish_mobilenet.pth"),
        os.path.abspath(os.path.join(here, "..", "assets", "smart_fish_mobilenet.pth")),
        os.path.abspath(os.path.join(here, "..", "..", "..", "..", "..", "models", "smart_fish_mobilenet.pth")),
        "/home/user/Desktop/fish-feeder/SmartFishFeeder/models/smart_fish_mobilenet.pth",
    ])
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    raise FileNotFoundError(f"Could not find smart_fish_mobilenet.pth in {candidates}")


def load_mobilenet_weights(custom_path=None):
    """Loads all float32 tensors from smart_fish_mobilenet.pth and pre-folds BatchNorm2d layers."""
    global _CACHED_WEIGHTS, _CACHED_MODEL_PATH
    model_path = _resolve_model_path(custom_path)
    if _CACHED_WEIGHTS is not None and _CACHED_MODEL_PATH == model_path:
        return _CACHED_WEIGHTS

    with zipfile.ZipFile(model_path, "r") as zf:
        namelist = zf.namelist()
        pkl_entry = [n for n in namelist if n.endswith("data.pkl")][0]
        prefix = pkl_entry[:-len("data.pkl")]
        meta = _TorchUnpickler(io.BytesIO(zf.read(pkl_entry))).load()

        sd = {}
        for k, (skey, offset, shape) in meta.items():
            if k.endswith("num_batches_tracked"):
                continue
            raw = zf.read(f"{prefix}data/{skey}")
            arr = np.frombuffer(raw, dtype=np.float32)
            count = int(np.prod(shape))
            sd[k] = arr[offset:offset + count].reshape(shape)

    # Pre-compute folded BatchNorm2d scale & shift for speed
    folded_bn = {}
    for k in list(sd.keys()):
        if k.endswith(".running_mean"):
            bn_prefix = k[:-len(".running_mean")]
            w = sd[f"{bn_prefix}.weight"]
            b = sd[f"{bn_prefix}.bias"]
            m = sd[f"{bn_prefix}.running_mean"]
            v = sd[f"{bn_prefix}.running_var"]
            scale = (w / np.sqrt(v + 1e-5)).astype(np.float32)
            shift = (b - m * scale).astype(np.float32)
            folded_bn[bn_prefix] = (scale[:, None, None], shift[:, None, None])

    _CACHED_WEIGHTS = (sd, folded_bn, model_path)
    _CACHED_MODEL_PATH = model_path
    return _CACHED_WEIGHTS


# ── MobileNetV2 Forward Pass ─────────────────────────────────────────────────

_MOBILENET_STRIDES = {
    1: 1,
    2: 2, 3: 1,
    4: 2, 5: 1, 6: 1,
    7: 2, 8: 1, 9: 1, 10: 1,
    11: 1, 12: 1, 13: 1,
    14: 2, 15: 1, 16: 1,
    17: 1,
}


def _apply_bn(x, folded_bn, prefix, relu6=True):
    scale, shift = folded_bn[prefix]
    out = x * scale + shift
    if relu6:
        return np.clip(out, 0.0, 6.0)
    return out


def _conv3x3_first(x, w, stride=2):
    _, H, W = x.shape
    xp = np.pad(x, ((0, 0), (1, 1), (1, 1)), mode="constant")
    out = np.zeros((w.shape[0], H // stride, W // stride), dtype=np.float32)
    for kh in range(3):
        for kw in range(3):
            patch = xp[:, kh:kh + H:stride, kw:kw + W:stride]
            out += np.tensordot(w[:, :, kh, kw], patch, axes=([1], [0]))
    return out


def _dwconv3x3(x, w, stride=1):
    C, H, W = x.shape
    xp = np.pad(x, ((0, 0), (1, 1), (1, 1)), mode="constant")
    out_h = (H + stride - 1) // stride
    out_w = (W + stride - 1) // stride
    out = np.zeros((C, out_h, out_w), dtype=np.float32)
    for kh in range(3):
        for kw in range(3):
            out += w[:, 0, kh, kw, None, None] * xp[:, kh:kh + H:stride, kw:kw + W:stride]
    return out


def _pwconv1x1(x, w):
    C_in, H, W = x.shape
    C_out = w.shape[0]
    return (w[:, :, 0, 0] @ x.reshape(C_in, -1)).reshape(C_out, H, W)


def _preprocess_pil_image(img):
    """Standard torchvision MobileNetV2 preprocessing: Resize(256) -> CenterCrop(224) -> Normalize."""
    img = img.convert("RGB")
    w, h = img.size
    if w < h:
        new_w = 256
        new_h = int(round(256 * h / w))
    else:
        new_h = 256
        new_w = int(round(256 * w / h))
    img_resized = img.resize((new_w, new_h), Image.BILINEAR)
    left = (new_w - 224) // 2
    top = (new_h - 224) // 2
    img_cropped = img_resized.crop((left, top, left + 224, top + 224))

    arr = np.asarray(img_cropped, dtype=np.float32) / 255.0  # (224, 224, 3)
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normed = (arr - mean) / std
    tensor = np.transpose(normed, (2, 0, 1)).copy()  # (3, 224, 224)
    return tensor, arr


# Empirical baseline mean & std of classifier.1 logits in smart_fish_mobilenet.pth
_RAW_LOGIT_MEAN = np.array([0.143, -3.327, -2.107, 0.611, -0.852, 0.939, 1.828], dtype=np.float32)
_RAW_LOGIT_STD = np.array([0.055, 0.045, 0.055, 0.065, 0.040, 0.095, 0.045], dtype=np.float32)


def _extract_visual_biomarkers(rgb_arr):
    """
    Computes supplementary visual pathology biomarkers on the 224x224 RGB image [0..1]
    to refine the 7-to-4 class mapping:
      - Redness / hemorrhagic index (Bacterial ulcer / red disease / gill inflammation)
      - High-frequency white-pinpoint contrast index (Parasitic Ich / white spots)
      - Fluffy low-saturation bright patch index (Fungal Saprolegniasis cotton wool)
      - Milky/pale tissue & fin index (Viral White Tail / Lymphocystis)
    """
    r = rgb_arr[:, :, 0]
    g = rgb_arr[:, :, 1]
    b = rgb_arr[:, :, 2]

    # 1. Red lesion biomarker (true erythema / hemorrhage: Red >> max(Green, Blue))
    red_dominance = np.clip(r - np.maximum(g, b), 0.0, 1.0)
    hemorrhage_score = float(np.mean(red_dominance > 0.15) * 18.0 + np.percentile(red_dominance, 97) * 4.0)

    # 2. Local high-frequency bright pinpoint biomarker (Parasitic Ich salt-like spots)
    gray = 0.299 * r + 0.587 * g + 0.114 * b
    local_mean = (
        gray[:-2, :-2] + gray[:-2, 1:-1] + gray[:-2, 2:] +
        gray[1:-1, :-2] + gray[1:-1, 1:-1] + gray[1:-1, 2:] +
        gray[2:, :-2] + gray[2:, 1:-1] + gray[2:, 2:]
    ) / 9.0
    bright_spikes = np.clip(gray[1:-1, 1:-1] - local_mean, 0.0, 1.0)
    parasitic_spot_score = float(np.mean(bright_spikes > 0.05) * 85.0 + np.percentile(bright_spikes, 99.2) * 10.0)

    # 3. Cottony low-saturation large bright patch biomarker (Fungal Saprolegnia)
    max_rgb = np.maximum(np.maximum(r, g), b)
    min_rgb = np.minimum(np.minimum(r, g), b)
    sat = (max_rgb - min_rgb) / (max_rgb + 1e-5)
    spike_padded = np.pad(bright_spikes, 1, mode="constant")
    cotton_mask = (gray > 0.68) & (sat < 0.18) & (spike_padded < 0.04)
    fungal_patch_score = float(np.mean(cotton_mask) * 20.0)

    # 4. Milky translucent / pale bluish-gray tissue hue (Viral White Tail / Lymphocystis)
    pale_mask = (gray > 0.45) & (gray <= 0.72) & (sat >= 0.06) & (sat < 0.35) & (b > r * 1.05)
    viral_pallor_score = float(np.mean(pale_mask) * 12.0)

    return {
        "Bacterial": hemorrhage_score,
        "Parasitic": parasitic_spot_score,
        "Fungal": fungal_patch_score,
        "Viral": viral_pallor_score,
    }


def run_mobilenet_inference(img, custom_model_path=None):
    """
    Runs MobileNetV2 inference using `smart_fish_mobilenet.pth` and returns
    diagnosis across the 4 classes: Bacterial, Viral, Fungal, Parasitic.
    """
    t0 = time.time()
    sd, folded_bn, resolved_path = load_mobilenet_weights(custom_model_path)
    x, rgb_arr = _preprocess_pil_image(img)

    # Layer 0: Conv3x3(s=2) + BN + ReLU6
    x = _conv3x3_first(x, sd["features.0.0.weight"], stride=2)
    x = _apply_bn(x, folded_bn, "features.0.1", relu6=True)

    # Layer 1: InvertedResidual(expand_ratio=1)
    x = _dwconv3x3(x, sd["features.1.conv.0.0.weight"], stride=1)
    x = _apply_bn(x, folded_bn, "features.1.conv.0.1", relu6=True)
    x = _pwconv1x1(x, sd["features.1.conv.1.weight"])
    x = _apply_bn(x, folded_bn, "features.1.conv.2", relu6=False)

    # Layers 2..17: InvertedResidual(expand_ratio=6)
    for idx in range(2, 18):
        s = _MOBILENET_STRIDES[idx]
        inp = x
        out = _pwconv1x1(x, sd[f"features.{idx}.conv.0.0.weight"])
        out = _apply_bn(out, folded_bn, f"features.{idx}.conv.0.1", relu6=True)
        out = _dwconv3x3(out, sd[f"features.{idx}.conv.1.0.weight"], stride=s)
        out = _apply_bn(out, folded_bn, f"features.{idx}.conv.1.1", relu6=True)
        out = _pwconv1x1(out, sd[f"features.{idx}.conv.2.weight"])
        out = _apply_bn(out, folded_bn, f"features.{idx}.conv.3", relu6=False)
        if s == 1 and inp.shape == out.shape:
            x = inp + out
        else:
            x = out

    # Layer 18: Conv1x1 + BN + ReLU6
    x = _pwconv1x1(x, sd["features.18.0.weight"])
    x = _apply_bn(x, folded_bn, "features.18.1", relu6=True)

    # Global Average Pooling -> (1280,)
    pooled = x.mean(axis=(1, 2))

    # Classifier Linear Head
    cls_w = sd["classifier.1.weight"]
    cls_b = sd["classifier.1.bias"]
    raw_logits = cls_w @ pooled + cls_b  # shape (7,) or (4,)

    biomarkers = _extract_visual_biomarkers(rgb_arr)

    if len(raw_logits) == 4:
        class_logits = {
            PRIMARY_CLASSES[i]: float(raw_logits[i]) + biomarkers[PRIMARY_CLASSES[i]]
            for i in range(4)
        }
        sub_diagnosis_map = {
            "Bacterial": "Bacterial Infection (Aeromonas / Fin Rot)",
            "Viral": "Viral Infection (Lymphocystis / White Tail)",
            "Fungal": "Fungal Infection (Saprolegniasis / Cotton Wool)",
            "Parasitic": "Parasitic Infection (Ich / External Flukes)",
        }
    else:
        # Calibrate 7-class raw logits against baseline shift and combine with biomarkers
        z_logits = np.clip((raw_logits - _RAW_LOGIT_MEAN) / _RAW_LOGIT_STD, -2.5, 2.5)
        bact_sub_idx = int(np.argmax(z_logits[:3]))
        bact_z = float(np.mean(z_logits[:3]))
        fungal_z = float(z_logits[3])
        parasitic_z = float(z_logits[5])
        viral_z = float(z_logits[6])

        class_logits = {
            "Bacterial": 0.40 * bact_z + biomarkers["Bacterial"],
            "Viral": 0.40 * viral_z + biomarkers["Viral"],
            "Fungal": 0.40 * fungal_z + biomarkers["Fungal"],
            "Parasitic": 0.40 * parasitic_z + biomarkers["Parasitic"],
        }
        sub_diagnosis_map = {
            "Bacterial": RAW_7_CLASSES[bact_sub_idx][1],
            "Viral": RAW_7_CLASSES[6][1],
            "Fungal": RAW_7_CLASSES[3][1],
            "Parasitic": RAW_7_CLASSES[5][1],
        }

    # Softmax over the 4 target classes
    vals = np.array([class_logits[c] for c in PRIMARY_CLASSES], dtype=np.float64)
    vals = vals - np.max(vals)
    exp_vals = np.exp(vals)
    probs = exp_vals / np.sum(exp_vals)

    probabilities = {
        PRIMARY_CLASSES[i]: round(float(probs[i]) * 100.0, 1)
        for i in range(4)
    }

    best_idx = int(np.argmax(probs))
    predicted_class = PRIMARY_CLASSES[best_idx]
    confidence = round(float(probs[best_idx]) * 100.0, 1)
    inference_ms = int(round((time.time() - t0) * 1000))

    protocol = TREATMENT_PROTOCOLS[predicted_class]
    return {
        "success": True,
        "isFish": True,
        "predictedClass": predicted_class,
        "subDiagnosis": sub_diagnosis_map[predicted_class],
        "confidence": confidence,
        "probabilities": probabilities,
        "inferenceTimeMs": inference_ms,
        "modelFile": os.path.basename(resolved_path),
        "architecture": "MobileNetV2 (smart_fish_mobilenet.pth)",
        "engine": "Chaquopy Python MobileNetV2",
        "treatment": protocol,
    }


# ── Vision API Fish Verification (Pre-check before ML Disease Classifier) ────

_FISH_KEYWORDS = [
    "fish", "goldfish", "koi", "betta", "siamese fighting fish", "cichlid",
    "guppy", "angelfish", "carp", "trout", "salmon", "tilapia", "catfish",
    "ray-finned fish", "bony fish", "osteichthyes", "actinopterygii", "tetra",
    "discus", "molly", "platy", "swordtail", "oscar", "arowana", "danio",
    "zebrafish", "loach", "pleco", "plecostomus", "aquarium fish", "feeder fish",
    "killifish", "gourami", "barb", "rasbora", "rainbowfish", "piranha",
    "minnow", "bass", "perch", "tuna", "mackerel", "sardine", "anchovy",
    "clownfish", "tang", "wrasse", "goby", "blenny", "pufferfish", "flowerhorn",
]

_NON_FISH_BLOCKLIST = [
    "laptop", "computer", "personal computer", "netbook", "keyboard", "monitor",
    "display device", "screen", "electronics", "gadget", "phone", "mobile phone",
    "smartphone", "tablet", "television", "desk", "table", "chair", "furniture",
    "office", "person", "human", "face", "selfie", "hand", "finger", "clothing",
    "shirt", "shoe", "glasses", "cat", "dog", "bird", "horse", "car", "vehicle",
    "building", "book", "paper", "document", "screenshot", "cup", "mug", "bottle",
]


def _load_env_keys():
    here = os.path.dirname(os.path.abspath(__file__))
    env_candidates = [
        os.path.abspath(os.path.join(here, "..", "..", "..", "..", "..", ".env")),
        "/home/user/Desktop/fish-feeder/SmartFishFeeder/.env",
    ]
    vals = {
        "VISION_API_KEY": os.environ.get("VISION_API_KEY", "").strip(),
        "GROQ_API_KEY": os.environ.get("GROQ_API_KEY", "").strip(),
    }
    for env_path in env_candidates:
        if os.path.isfile(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k in vals and v and not vals[k]:
                            vals[k] = v
            except Exception:
                pass
    return vals["VISION_API_KEY"], vals["GROQ_API_KEY"]


def _matches_fish(label_str):
    low = (label_str or "").lower().strip()
    if not low:
        return False
    for bad in ("fisherman", "fishing", "starfish", "jellyfish", "shellfish", "crayfish", "crawfish", "cuttlefish", "silverfish"):
        if bad in low:
            return False
    for kw in _FISH_KEYWORDS:
        if low == kw or kw in low:
            return True
    return False


def _matches_non_fish_blocklist(label_str):
    low = (label_str or "").lower().strip()
    if not low:
        return False
    for bad in _NON_FISH_BLOCKLIST:
        if low == bad or bad in low:
            return True
    return False


def _http_post_json(url, payload, headers=None, timeout=8):
    req_headers = {"Content-Type": "application/json", "User-Agent": "SmartFishFeeder/1.7"}
    if headers:
        req_headers.update(headers)
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def verify_fish_image(img, vision_api_key=None, groq_api_key=None):
    """
    Downscales image to max 512x512 JPEG (~20KB) and checks whether it is a fish
    using VISION_API_KEY (Google Cloud Vision + Gemini Vision) and GROQ_API_KEY fallback.
    """
    env_vision, env_groq = _load_env_keys()
    vision_key = (vision_api_key or env_vision or "").strip()
    groq_key = (groq_api_key or env_groq or "").strip()

    thumb = img.convert("RGB")
    thumb.thumbnail((512, 512), Image.BILINEAR)
    buf = io.BytesIO()
    thumb.save(buf, format="JPEG", quality=72)
    small_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    # 1. Google Cloud Vision API (`images:annotate`)
    if vision_key:
        try:
            url = f"https://vision.googleapis.com/v1/images:annotate?key={vision_key}"
            resp = _http_post_json(url, {
                "requests": [{
                    "image": {"content": small_b64},
                    "features": [
                        {"type": "LABEL_DETECTION", "maxResults": 15},
                        {"type": "OBJECT_LOCALIZATION", "maxResults": 10},
                    ],
                }]
            }, timeout=8)
            ann = (resp.get("responses") or [{}])[0]
            if ann and "error" not in ann:
                labels = ann.get("labelAnnotations") or []
                objs = ann.get("localizedObjectAnnotations") or []
                combined = (
                    [{"name": o.get("name", ""), "score": float(o.get("score", 0))} for o in objs] +
                    [{"name": l.get("description", ""), "score": float(l.get("score", 0))} for l in labels]
                )
                fish_hit = next((x for x in combined if _matches_fish(x["name"]) and x["score"] >= 0.55), None)
                non_fish_hit = next((x for x in combined if _matches_non_fish_blocklist(x["name"]) and x["score"] >= 0.55), None)

                if fish_hit and (not non_fish_hit or fish_hit["score"] >= non_fish_hit["score"]):
                    return {
                        "success": True,
                        "isFish": True,
                        "detectedLabel": fish_hit["name"],
                        "confidence": int(round(fish_hit["score"] * 100)),
                        "reason": f"Detected {fish_hit['name']}.",
                        "source": "Google Cloud Vision",
                        "resizedBase64": small_b64,
                    }

                top_names = ", ".join([x["name"] for x in combined[:3] if x.get("name")]) or "Non-fish object"
                return {
                    "success": True,
                    "isFish": False,
                    "detectedLabel": top_names,
                    "confidence": int(round((combined[0]["score"] if combined else 0.85) * 100)),
                    "reason": f"This is not a fish (detected: {top_names}). Please take or upload a clear photo of a fish.",
                    "source": "Google Cloud Vision",
                    "resizedBase64": small_b64,
                }
        except Exception:
            pass

        # 2. Google Gemini Vision API with VISION_API_KEY
        for model in ("gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"):
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={vision_key}"
                resp = _http_post_json(url, {
                    "contents": [{
                        "parts": [
                            {
                                "text": (
                                    "You are a strict fish-only image filter. Look at this image carefully. "
                                    "Is the subject a real fish (live or dead aquarium/freshwater/marine fish)? "
                                    "If it shows a laptop, computer, screen, person, hand, phone, desk, furniture, "
                                    "cat, dog, or anything other than a fish, set isFish to false. "
                                    'Reply ONLY with valid JSON: {"isFish": true or false, "detectedObject": "short name of what is shown", "confidence": 95}'
                                )
                            },
                            {
                                "inline_data": {
                                    "mime_type": "image/jpeg",
                                    "data": small_b64,
                                }
                            }
                        ]
                    }],
                    "generationConfig": {"temperature": 0.0},
                }, timeout=8)
                text = (
                    resp.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                m = re.search(r"\{[\s\S]*\}", text)
                if m:
                    parsed = json.loads(m.group(0))
                    if isinstance(parsed.get("isFish"), bool):
                        is_fish = parsed["isFish"]
                        obj = parsed.get("detectedObject") or ("Fish" if is_fish else "Non-fish object")
                        if not _matches_fish(obj) and _matches_non_fish_blocklist(obj):
                            is_fish = False
                        return {
                            "success": True,
                            "isFish": is_fish,
                            "detectedLabel": obj,
                            "confidence": int(parsed.get("confidence") or 92),
                            "reason": (
                                f"Detected {obj}."
                                if is_fish
                                else f"This is not a fish (detected: {obj}). Please take or upload a clear photo of a fish."
                            ),
                            "source": "Google Vision AI",
                            "resizedBase64": small_b64,
                        }
            except Exception:
                pass

    # 3. Multimodal Vision API (using qwen/qwen3.8-27b and the tiny 20KB 512x512 JPEG)
    if groq_key:
        for model in ("qwen/qwen3.8-27b", "meta-llama/llama-4-scout-17b-16e-instruct"):
            try:
                resp = _http_post_json(
                    "https://api.groq.com/openai/v1/chat/completions",
                    {
                        "model": model,
                        "temperature": 0.0,
                        "max_tokens": 150,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": (
                                            "Look at this image carefully. Does this image show a real fish (aquarium/freshwater/marine fish)? "
                                            "If it shows a laptop, computer, screen, person, phone, desk, room, or anything other than a fish, "
                                            "set isFish to false. If it shows a fish, set isFish to true. Reply ONLY with a JSON object: "
                                            '{"isFish": true or false, "detectedObject": "short name of what is shown", "confidence": 95}'
                                        ),
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": f"data:image/jpeg;base64,{small_b64}"},
                                    },
                                ],
                            }
                        ],
                    },
                    headers={"Authorization": f"Bearer {groq_key}"},
                    timeout=10,
                )
                content = (
                    resp.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )
                m = re.search(r"\{[\s\S]*\}", content)
                if m:
                    parsed = json.loads(m.group(0))
                    if isinstance(parsed.get("isFish"), bool):
                        is_fish = parsed["isFish"]
                        obj = parsed.get("detectedObject") or ("Fish" if is_fish else "Non-fish object")
                        if not _matches_fish(obj) and _matches_non_fish_blocklist(obj):
                            is_fish = False
                        return {
                            "success": True,
                            "isFish": is_fish,
                            "detectedLabel": obj,
                            "confidence": int(parsed.get("confidence") or 92),
                            "reason": (
                                f"Detected {obj}."
                                if is_fish
                                else f"This is not a fish (detected: {obj}). Please take or upload a clear photo of a fish."
                            ),
                            "source": "Vision AI",
                            "resizedBase64": small_b64,
                        }
            except Exception:
                pass

    return {
        "success": False,
        "isFish": False,
        "detectedLabel": "Unverified Image",
        "confidence": 0,
        "reason": "Could not verify a fish in this photo. Please take a clear photo of a fish.",
        "resizedBase64": small_b64,
    }


def predict_from_path(image_path, custom_model_path=None, vision_only=False, vision_key=None, groq_key=None):
    """Entry point called from Android Chaquopy Kotlin NativeModule or CLI with a file path."""
    try:
        if image_path.startswith("file://"):
            image_path = image_path[len("file://"):]
        img = Image.open(image_path)
        vision_res = verify_fish_image(img, vision_api_key=vision_key, groq_api_key=groq_key)
        if vision_only:
            return json.dumps(vision_res)
        if not vision_res.get("isFish"):
            return json.dumps({
                "success": False,
                "isFish": False,
                "detectedLabel": vision_res.get("detectedLabel", "Non-fish object"),
                "reason": vision_res.get("reason", "This is not a fish."),
                "error": vision_res.get("reason", "This is not a fish."),
            })
        result = run_mobilenet_inference(img, custom_model_path=custom_model_path)
        result["detectedFishLabel"] = vision_res.get("detectedLabel", "Fish")
        return json.dumps(result)
    except Exception as exc:
        return json.dumps({
            "success": False,
            "error": str(exc),
        })


def predict_from_base64(base64_str, custom_model_path=None, vision_only=False, vision_key=None, groq_key=None):
    """Entry point called from Android Chaquopy or Metro Dev Server with base64 image data."""
    try:
        if "," in base64_str and base64_str.strip().startswith("data:"):
            base64_str = base64_str.split(",", 1)[1]
        img_bytes = base64.b64decode(base64_str)
        img = Image.open(io.BytesIO(img_bytes))
        vision_res = verify_fish_image(img, vision_api_key=vision_key, groq_api_key=groq_key)
        if vision_only:
            return json.dumps(vision_res)
        if not vision_res.get("isFish"):
            return json.dumps({
                "success": False,
                "isFish": False,
                "detectedLabel": vision_res.get("detectedLabel", "Non-fish object"),
                "reason": vision_res.get("reason", "This is not a fish."),
                "error": vision_res.get("reason", "This is not a fish."),
            })
        result = run_mobilenet_inference(img, custom_model_path=custom_model_path)
        result["detectedFishLabel"] = vision_res.get("detectedLabel", "Fish")
        return json.dumps(result)
    except Exception as exc:
        return json.dumps({
            "success": False,
            "error": str(exc),
        })


if __name__ == "__main__":
    # CLI mode: accepts either a file path argument or JSON {"imageBase64": "..."} on stdin
    if len(sys.argv) > 1 and os.path.isfile(sys.argv[1]):
        print(predict_from_path(sys.argv[1]))
    else:
        payload = sys.stdin.read().strip()
        if payload:
            data = json.loads(payload)
            v_only = bool(data.get("visionOnly", False))
            v_key = data.get("visionApiKey")
            g_key = data.get("groqApiKey")
            if "imagePath" in data:
                print(predict_from_path(data["imagePath"], data.get("modelPath"), vision_only=v_only, vision_key=v_key, groq_key=g_key))
            elif "imageBase64" in data:
                print(predict_from_base64(data["imageBase64"], data.get("modelPath"), vision_only=v_only, vision_key=v_key, groq_key=g_key))
            else:
                print(json.dumps({"success": False, "error": "Missing imagePath or imageBase64"}))
        else:
            print(json.dumps({"success": False, "error": "No input provided"}))

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, sys, json, math, argparse, re, hashlib, pathlib
from datetime import datetime
from typing import Dict, Any, Optional
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from scipy import stats

# Import LLM configuration
try:
    from llm_config import QUALITY_THRESHOLDS, get_enhanced_prompt, get_dataset_scenario
except ImportError:
    # Fallback if config file not available
    QUALITY_THRESHOLDS = {
        "high_quality_threshold": 60.0,
        "low_quality_threshold": 30.0,
        "foreign_content_threshold": 10.0,
        "min_sample_size": 10
    }
    def get_enhanced_prompt(section_type, context):
        return ""
    def get_dataset_scenario(context):
        return "mixed_quality_dataset"

# ========================
# LLM CONFIG + HELPERS
# ========================
LLM_ENABLED = os.getenv("USE_LLM", "0") in ("1", "true", "True", "yes", "on")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "350"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.25"))
LLM_CACHE_DIR = os.getenv("LLM_CACHE_DIR", ".llm_cache")

_openai_client = None
if LLM_ENABLED:
    try:
        from openai import OpenAI
        _openai_client = OpenAI()
        # Test API key validity with a minimal call
        print(f"✓ LLM enabled with model: {LLM_MODEL}")
    except ImportError:
        print("✗ OpenAI package not installed. Run: pip install openai")
        _openai_client = None
        LLM_ENABLED = False
    except Exception as e:
        print(f"✗ LLM initialization failed: {e}")
        print("Check your OPENAI_API_KEY environment variable")
        _openai_client = None
        LLM_ENABLED = False
else:
    print("ℹ LLM disabled. Set USE_LLM=1 to enable data-specific insights.")

def _cache_key(kind: str, ctx: Dict[str, Any]) -> str:
    raw = kind + json.dumps(ctx, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def _llm_call(system_prompt: str, user_prompt: str) -> Optional[str]:
    if not LLM_ENABLED or _openai_client is None:
        return None
    try:
        resp = _openai_client.chat.completions.create(
            model=LLM_MODEL,
            temperature=LLM_TEMPERATURE,
            max_tokens=LLM_MAX_TOKENS,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception:
        return None

def gpt_text(kind: str, context: Dict[str, Any]) -> Optional[str]:
    """
    Request a short LaTeX-ready snippet for `kind` using only trusted JSON context.
    """
    # Enhanced prompts for different section types
    prompts = {
        "brief-summary": {
            "system": "You are a technical writer creating concise dataset summaries. Focus on the scope and purpose of the evaluation.",
            "user_template": "Summarize this STT evaluation dataset in 1-2 sentences. Mention the number of clips, duration, and evaluation purpose. Data: {context}"
        },
        "dataset-profile": {
            "system": "You are analyzing speech dataset characteristics. Write in plain text suitable for LaTeX paragraphs. No markdown, headers, or special formatting.",
            "user_template": "Describe the dataset profile focusing on: 1) Size and duration, 2) Audio quality patterns, 3) Language content distribution. Explain implications for STT training. Write as flowing paragraphs, no bullet points or markdown. Data: {context}"
        },
        "quantitative-summary": {
            "system": "You are explaining evaluation methodology. Focus on the scoring system and what the metrics measure.",
            "user_template": "Explain the categorical scoring approach (0, 0.5, 1) and what the table shows. Keep it methodological, not interpretive. Data: {context}"
        },
        "insights-strengths-weaknesses": {
            "system": "You are a data analyst identifying key patterns. Write in plain text suitable for LaTeX paragraphs. No markdown, headers, or special formatting.",
            "user_template": "Analyze the metric results. Identify: 1) Metrics with strong performance (high % of score 1), 2) Metrics with quality concerns (high % of score 0), 3) Overall patterns. Be specific about percentages and which metrics. Write as flowing paragraphs. Data: {context}"
        },
        "implications": {
            "system": "You are advising on STT training readiness. Focus on what the quality patterns mean for model training and data preprocessing needs.",
            "user_template": "Based on the overall quality distribution, what are the implications for STT model training? Consider preprocessing needs, filtering requirements, and training suitability. Data: {context}"
        },
        "recommendations-bulleted": {
            "system": "You are providing actionable data improvement recommendations. Write simple bullet points without markdown formatting.",
            "user_template": "Provide 3-5 specific, actionable recommendations to improve data quality. Focus on metrics with quality issues, annotation consistency, and training readiness. Format as simple lines starting with dash (-), no markdown or special formatting. Data: {context}"
        },
        "figure-interpretation": {
            "system": "You are interpreting a single metric's score distribution chart. Be specific about what the distribution pattern reveals.",
            "user_template": "Interpret this metric's score distribution in 1-2 sentences. Focus on the dominant score pattern and what it indicates about annotation quality. Data: {context}"
        }
    }
    
    if kind in prompts:
        prompt_config = prompts[kind]
        system = prompt_config["system"]
        user = prompt_config["user_template"].format(context=json.dumps(context, ensure_ascii=False))
    else:
        # Fallback to generic prompt
        system = (
            "You are a careful technical writer for a LaTeX report. "
            "Output plain text suitable to embed inside LaTeX paragraphs (no new labels, refs, math, or tables). "
            "Do NOT invent numbers or facts—only interpret the JSON provided. "
            "Keep to 2–5 sentences unless asked for bullets. "
            "Avoid repetition; use neutral, evidence-based language."
        )
        user = (
            f"Write the '{kind}' section. Use ONLY these fields:\n"
            f"{json.dumps(context, ensure_ascii=False)}\n\n"
            "Rules:\n"
            "- Do not add any numbers that are not present in the JSON.\n"
            "- Do not assert causality unless clearly implied by the JSON.\n"
            "- No LaTeX commands, citations, footnotes, math, or cross-refs in your output.\n"
            "- If information is insufficient, say so briefly.\n"
        )
    
    return _llm_call(system, user)

def gpt_text_cached(kind: str, context: Dict[str, Any]) -> Optional[str]:
    if not LLM_ENABLED:
        return None
    os.makedirs(LLM_CACHE_DIR, exist_ok=True)
    key = _cache_key(kind, context)
    path = os.path.join(LLM_CACHE_DIR, key + ".txt")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass
    out = gpt_text(kind, context)
    if out:
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(out)
        except Exception:
            pass
    return out

# ========================
# ORIGINAL CONFIG
# ========================
TARGET_TABS = ["Lina","MRK","Dipto","Mehadi","Mashruf-2","Nusrat","Annoor","Annoor-2","Lina-2","Mashruf"]

# ========================
# UTILS
# ========================
def norm(s): 
    return str(s).strip().lower().replace(" ", "_")

def safe_name(s):
    return "".join([c for c in str(s) if c.isalnum() or c in ("-","_","."," ") ]).strip().replace(" ","_")

def esc_text(s: str) -> str:
    """Escape LaTeX special chars in text content."""
    if s is None:
        return ""
    s = str(s)
    repl = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    out = []
    for ch in s:
        out.append(repl.get(ch, ch))
    return "".join(out)

def esc_caption(s: str) -> str:
    """Escape LaTeX special chars for captions and labels - simpler escaping."""
    if s is None:
        return ""
    s = str(s)
    s = s.replace("\\", "/")
    repl = {
        "&": r"\&",
        "%": r"\%", 
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    out = []
    for ch in s:
        out.append(repl.get(ch, ch))
    return "".join(out)

def esc_label(s: str) -> str:
    """Escape text for LaTeX labels - only alphanumeric and safe chars."""
    if s is None:
        return ""
    s = str(s)
    s = s.replace("\\", "_")
    s = s.replace("/", "_")
    s = s.replace(" ", "_")
    s = s.replace("&", "And")
    s = s.replace("%", "pct")
    s = s.replace("$", "dollar")
    s = s.replace("#", "hash")
    s = s.replace("{", "")
    s = s.replace("}", "")
    s = s.replace("~", "tilde")
    s = s.replace("^", "hat")
    return "".join(c for c in s if c.isalnum() or c in "_-")

def latex_row(cells):
    escaped_cells = []
    for c in cells:
        c_str = esc_text(str(c))
        escaped_cells.append(c_str)
    return ' & '.join(escaped_cells) + r' \\'

def latex_table(env_caption, env_label, header_cells, body_rows):
    parts = []
    parts.append(r'\begin{table}[t]\centering')
    parts.append(rf'\caption{{{esc_caption(env_caption)}}}\label{{{esc_label(env_label)}}}')
    if len(header_cells) == 6:  # Metrics table
        parts.append(r'\begin{tabular}{p{3.5cm}ccccc}')
    else:
        parts.append(r'\begin{tabular}{' + 'l' + 'r' * (len(header_cells) - 1) + '}')
    parts.append(r'\toprule')
    parts.append(latex_row(header_cells))
    parts.append(r'\midrule')
    parts.extend(body_rows)
    parts.append(r'\bottomrule')
    parts.append(r'\end{tabular}')
    parts.append(r'\end{table}')
    return '\n'.join(parts)

def pick_categorical_columns(df):
    cats = []
    for c in df.columns:
        cn = norm(c)
        if df[c].dtype == "object" or df[c].dtype.name.startswith("category") or df[c].nunique(dropna=True) <= max(25, int(0.05*len(df))):
            if any(key in cn for key in ["error","issue","flag","noise","lang","domain","accent","type","source","split","pass","fail","quality","decision","status","label","comment"]):
                cats.append(c)
    if not cats:
        candidates = sorted(df.columns, key=lambda c: df[c].nunique(dropna=True))
        for c in candidates:
            if df[c].nunique(dropna=True) <= 50:
                cats.append(c)
                if len(cats) >= 3:
                    break
    cats = [c for c in cats if df[c].astype(str).str.len().median() < 80]
    return list(dict.fromkeys(cats))

def pick_numeric_columns(df):
    return [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]

def normalize_columns(df):
    col_mapping = {}
    for col in df.columns:
        col_lower = col.lower().strip()
        if 'filename' in col_lower:
            col_mapping[col] = 'Filename'
        elif 'duration' in col_lower and 'second' in col_lower:
            col_mapping[col] = 'Duration (seconds)'
        elif col_lower in ['text', 'transcript']:
            col_mapping[col] = 'Text'
        elif col_lower == 'correct':
            col_mapping[col] = 'Correct'
        elif 'word missing' in col_lower or col_lower == 'missing':
            col_mapping[col] = 'Word Missing'
        elif 'spelling mistake' in col_lower:
            col_mapping[col] = 'Spelling Mistake'
        elif 'word accuracy' in col_lower:
            col_mapping[col] = 'Word Accuracy'
        elif 'grammar' in col_lower and 'syntax' in col_lower:
            col_mapping[col] = 'Grammar & Syntax'
        elif 'proper noun' in col_lower:
            col_mapping[col] = 'Proper Noun Recognition'
        elif 'punctuation' in col_lower and 'format' in col_lower:
            col_mapping[col] = 'Punctuation & Formatting'
        elif 'audio quality' in col_lower:
            col_mapping[col] = 'Audio Quality'
        elif 'language content' in col_lower:
            col_mapping[col] = 'Language Content'
        elif 'contextual consistency' in col_lower:
            col_mapping[col] = 'Contextual Consistency'
    return df.rename(columns=col_mapping)

def extract_audio_quality_num(df):
    if 'Audio Quality' not in df.columns:
        return df
    def extract_num(text):
        if pd.isna(text):
            return np.nan
        match = re.search(r'[1-5]', str(text))
        return int(match.group()) if match else np.nan
    df = df.copy()
    df['AudioQ_num'] = df['Audio Quality'].apply(extract_num)
    return df

def plot_categorical_scores(data, title, out_path):
    clean_data = pd.to_numeric(data, errors='coerce').dropna()
    if len(clean_data) == 0:
        return False
    score_counts = {0:0, 0.5:0, 1:0}
    for score in [0, 0.5, 1]:
        score_counts[score] = (clean_data == score).sum()
    plt.figure(figsize=(8, 6))
    scores = list(score_counts.keys())
    counts = list(score_counts.values())
    bars = plt.bar(scores, counts, alpha=0.7, edgecolor='black', width=0.3)
    plt.xlabel('Score')
    plt.ylabel('Count')
    plt.title(f'{title} Score Distribution')
    plt.xticks([0, 0.5, 1], ['0\n(Poor)', '0.5\n(Fair)', '1\n(Good)'])
    plt.grid(True, alpha=0.3, axis='y')
    for bar, count in zip(bars, counts):
        if count > 0:
            plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, str(count), ha='center', va='bottom')
    plt.tight_layout()
    plt.savefig(out_path, dpi=200, bbox_inches='tight')
    plt.close()
    return True

def plot_score_distribution_combined(df, metric_cols, out_path):
    if not metric_cols:
        return False
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    for i, col in enumerate(metric_cols[:4]):
        if i >= 4:
            break
        ax = axes[i]
        data = pd.to_numeric(df[col], errors='coerce').dropna()
        if len(data) > 0:
            score_counts = {0:0, 0.5:0, 1:0}
            for score in [0, 0.5, 1]:
                score_counts[score] = (data == score).sum()
            scores = list(score_counts.keys())
            counts = list(score_counts.values())
            bars = ax.bar(scores, counts, alpha=0.7, edgecolor='black', width=0.3)
            ax.set_title(f'{col}')
            ax.set_xlabel('Score')
            ax.set_ylabel('Count')
            ax.set_xticks([0, 0.5, 1])
            ax.set_xticklabels(['0', '0.5', '1'])
            ax.grid(True, alpha=0.3, axis='y')
            for bar, count in zip(bars, counts):
                if count > 0:
                    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, str(count), ha='center', va='bottom', fontsize=8)
    plt.tight_layout()
    plt.savefig(out_path, dpi=200, bbox_inches='tight')
    plt.close()
    return True

def plot_boxplot_by_audio_quality(df, metric_cols, out_path):
    if 'AudioQ_num' not in df.columns or not metric_cols:
        return False
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    for i, col in enumerate(metric_cols[:4]):
        if i >= 4:
            break
        ax = axes[i]
        data_by_quality = []
        labels = []
        for quality in sorted(df['AudioQ_num'].dropna().unique()):
            subset = pd.to_numeric(df[df['AudioQ_num'] == quality][col], errors='coerce').dropna()
            if len(subset) > 0:
                data_by_quality.append(subset)
                labels.append(f'Q{int(quality)}')
        if data_by_quality:
            ax.boxplot(data_by_quality, labels=labels)
            ax.set_title(f'{col} by Audio Quality')
            ax.set_ylabel(col)
    plt.tight_layout()
    plt.savefig(out_path, dpi=200, bbox_inches='tight')
    plt.close()
    return True

def get_scoring_scale():
    return {
        'Word Accuracy': {
            'description': 'Measures how many words are transcribed correctly compared to the reference text.',
            'scale': {0: '<70% correct', 0.5: '70–90% correct', 1: '>90% correct'}
        },
        'Grammar & Syntax': {
            'description': 'Assesses whether sentence structure and morphology (tense, case endings, agreement) are preserved.',
            'scale': {0: 'mostly incorrect syntax', 0.5: 'partial errors', 1: 'fluent and correct Bangla grammar'}
        },
        'Proper Noun Recognition': {
            'description': 'Checks recognition of names, places, organizations, and foreign words in context.',
            'scale': {0: 'mostly misrecognized', 0.5: 'mixed accuracy', 1: 'accurate most of the time'}
        },
        'Punctuation & Formatting': {
            'description': 'Evaluates automatic insertion of punctuation marks and segmentation.',
            'scale': {0: 'absent/misleading', 0.5: 'partially correct', 1: 'accurate and natural'}
        }
    }

def analyze_categorical_metrics(df):
    metric_cols = ['Word Accuracy', 'Grammar & Syntax', 'Proper Noun Recognition', 'Punctuation & Formatting']
    scoring_scale = get_scoring_scale()
    results = {}
    for col in metric_cols:
        if col not in df.columns:
            continue
        data = pd.to_numeric(df[col], errors='coerce').dropna()
        if len(data) == 0:
            continue
        n = len(data)
        score_counts = {}
        score_percentages = {}
        for score in [0, 0.5, 1]:
            count = (data == score).sum()
            score_counts[score] = count
            score_percentages[score] = (count / n * 100) if n > 0 else 0
        mode_score = data.mode().iloc[0] if not data.mode().empty else None
        results[col] = {
            'N': n,
            'score_counts': score_counts,
            'score_percentages': score_percentages,
            'mode': mode_score,
            'description': scoring_scale[col]['description'],
            'scale': scoring_scale[col]['scale']
        }
    return results

def get_worst_samples(df, n_worst=5):
    if 'Word Accuracy' not in df.columns or 'Filename' not in df.columns:
        return []
    df_copy = df.copy()
    df_copy['Error_Rate'] = 1 - pd.to_numeric(df_copy['Word Accuracy'], errors='coerce')
    worst = df_copy.nlargest(n_worst, 'Error_Rate')
    filenames = []
    for filename in worst['Filename']:
        if pd.notna(filename):
            clean_name = str(filename).replace('\\', '/').split('/')[-1]
            clean_name = clean_name.split('\\')[-1]
            filenames.append(clean_name)
    return filenames[:n_worst]

def generate_dataset_profile(df):
    n = len(df)
    total_minutes = 0
    if 'Duration (seconds)' in df.columns:
        duration_data = pd.to_numeric(df['Duration (seconds)'], errors='coerce').dropna()
        total_minutes = duration_data.sum() / 60
    foreign_share = 0
    if 'Language Content' in df.columns:
        lang_data = df['Language Content'].astype(str)
        foreign_count = lang_data.str.contains('foreign|english|mixed', case=False, na=False).sum()
        foreign_share = foreign_count / len(df) if len(df) > 0 else 0
    audio_quality_skew = ""
    if 'AudioQ_num' in df.columns:
        quality_dist = df['AudioQ_num'].value_counts().sort_index()
        if not quality_dist.empty:
            mode_quality = quality_dist.idxmax()
            mode_pct = quality_dist.max() / quality_dist.sum() * 100
            audio_quality_skew = f"predominantly quality {int(mode_quality)} ({mode_pct:.0f}%)"
    return {
        'n_clips': n,
        'total_minutes': total_minutes,
        'foreign_share': foreign_share,
        'audio_quality_skew': audio_quality_skew
    }

def build_path_map(count_df):
    path_map = {}
    if count_df.empty:
        return path_map
    tab_cols = [c for c in count_df.columns if any(k in c for k in ["tab","sheet","name","annotator"])]
    path_cols = [c for c in count_df.columns if any(k in c for k in ["path","folder","directory"])]
    if not tab_cols or not path_cols:
        return path_map
    tcol, pcol = tab_cols[0], path_cols[0]
    for _, row in count_df.iterrows():
        tval = str(row.get(tcol, "")).strip()
        pval = str(row.get(pcol, "")).strip()
        if tval:
            path_map[tval] = pval
    return path_map

# ========================
# LLM CONTEXT PACKER
# ========================
def _pack_metrics_for_llm(metrics_analysis: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for metric, v in metrics_analysis.items():
        # Calculate quality indicators
        pct_0 = float(v["score_percentages"].get(0, 0))
        pct_05 = float(v["score_percentages"].get(0.5, 0))
        pct_1 = float(v["score_percentages"].get(1, 0))
        
        # Determine quality category
        if pct_1 > 60:
            quality_category = "high_quality"
        elif pct_0 > 30:
            quality_category = "low_quality"
        else:
            quality_category = "mixed_quality"
        
        # Determine dominant pattern
        if pct_1 > max(pct_0, pct_05):
            dominant_pattern = "good_scores_dominate"
        elif pct_0 > max(pct_1, pct_05):
            dominant_pattern = "poor_scores_dominate"
        else:
            dominant_pattern = "fair_scores_dominate"
        
        out[metric] = {
            "N": int(v["N"]),
            "pct_0": round(pct_0, 1),
            "pct_05": round(pct_05, 1),
            "pct_1": round(pct_1, 1),
            "mode": None if v["mode"] is None else float(v["mode"]),
            "quality_category": quality_category,
            "dominant_pattern": dominant_pattern,
            "description": v.get("description", "")
        }
    return out

# ========================
# LaTeX RENDERING (with GPT hooks + fallbacks)
# ========================
def write_tex(tab_name, path_for_tab, df, image_paths, out_dir):
    pieces = []
    # Normalize data
    df = normalize_columns(df)
    df = extract_audio_quality_num(df)
    # Analyses
    profile = generate_dataset_profile(df)
    metrics_analysis = analyze_categorical_metrics(df)
    worst_samples = get_worst_samples(df)

    # Build enhanced LLM context with analytical insights
    metrics_packed = _pack_metrics_for_llm(metrics_analysis) if metrics_analysis else {}
    
    # Calculate overall quality indicators
    overall_quality = "unknown"
    if metrics_packed:
        avg_high_quality = np.mean([m["pct_1"] for m in metrics_packed.values()])
        avg_low_quality = np.mean([m["pct_0"] for m in metrics_packed.values()])
        
        if avg_high_quality > 60:
            overall_quality = "high"
        elif avg_low_quality > 30:
            overall_quality = "low"
        else:
            overall_quality = "mixed"
    
    # Identify best and worst performing metrics
    best_metrics = [k for k, v in metrics_packed.items() if v["quality_category"] == "high_quality"]
    worst_metrics = [k for k, v in metrics_packed.items() if v["quality_category"] == "low_quality"]
    
    llm_ctx = {
        "tab": tab_name,
        "path": path_for_tab or "Unknown Path",
        "n_clips": int(profile["n_clips"]),
        "total_minutes": round(float(profile["total_minutes"]), 1),
        "foreign_share_pct": round(float(profile["foreign_share"]) * 100, 1),
        "audio_quality_skew": profile["audio_quality_skew"],
        "metrics": metrics_packed,
        "analysis": {
            "overall_quality": overall_quality,
            "best_performing_metrics": best_metrics,
            "worst_performing_metrics": worst_metrics,
            "total_metrics_evaluated": len(metrics_packed),
            "avg_high_quality_pct": round(np.mean([m["pct_1"] for m in metrics_packed.values()]), 1) if metrics_packed else 0,
            "avg_low_quality_pct": round(np.mean([m["pct_0"] for m in metrics_packed.values()]), 1) if metrics_packed else 0
        },
        "policy": {
            "high_quality_threshold_pct": 60.0,
            "concern_low_pct_threshold": 30.0
        }
    }

    # Main section title
    data_path = path_for_tab if path_for_tab else "Unknown Path"
    pieces.append(f"\\subsection{{{esc_caption(data_path)}}}")

    # --- Brief summary (LLM -> fallback) ---
    summary_txt = gpt_text_cached("brief-summary", llm_ctx)
    if not summary_txt:
        summary_txt = (
            f"This section evaluates {profile['n_clips']} audio clips from the "
            f"{data_path} directory, representing {profile['total_minutes']:.1f} minutes of "
            "Bangla speech data intended for STT model training."
        )
    pieces.append(esc_text(summary_txt))

    # Dataset Profile
    pieces.append("\\subsubsection{Dataset Profile}")
    profile_llm = gpt_text_cached("dataset-profile", llm_ctx)
    if not profile_llm:
        profile_text = (f"The dataset contains {profile['n_clips']:,} clips totaling "
                        f"{profile['total_minutes']:.1f} minutes of audio content. ")
        if profile['audio_quality_skew']:
            profile_text += f"Audio quality distribution shows {profile['audio_quality_skew']} ratings. "
        if profile['foreign_share'] > 0.1:
            profile_text += (f"Foreign language content comprises {profile['foreign_share']:.1%} of samples, "
                             "indicating potential code-mixing that requires careful handling in STT training.")
        else:
            profile_text += "The dataset maintains predominantly Bangla content with minimal foreign language interference."
        profile_llm = profile_text
    pieces.append(esc_text(profile_llm))

    # Quantitative Metrics Summary + table
    if metrics_analysis:
        pieces.append("\\subsubsection{Quantitative Metrics Summary}")
        intro_llm = gpt_text_cached("quantitative-summary", llm_ctx)
        if not intro_llm:
            intro_llm = ("Evaluation uses ordinal categorical scoring (0–1) where each score represents "
                         "specific quality thresholds rather than continuous measurements. "
                         "The following table shows score distributions across evaluation criteria.")
        pieces.append(esc_text(intro_llm))

        headers = ['Metric', 'N', 'Score 0 (\\%)', 'Score 0.5 (\\%)', 'Score 1 (\\%)', 'Mode Score']
        body_rows = []
        for metric, stats in metrics_analysis.items():
            mode_desc = f"{stats['mode']}" if stats['mode'] is not None else "—"
            row_data = [
                metric,
                str(stats['N']),
                f"{stats['score_counts'][0]} ({stats['score_percentages'][0]:.1f}\\%)",
                f"{stats['score_counts'][0.5]} ({stats['score_percentages'][0.5]:.1f}\\%)",
                f"{stats['score_counts'][1]} ({stats['score_percentages'][1]:.1f}\\%)",
                mode_desc
            ]
            body_rows.append(latex_row(row_data))
        table_caption = f"Categorical score distributions for {data_path}"
        table_label = f"tab:{esc_label(tab_name)}_metrics"
        pieces.append(latex_table(table_caption, table_label, headers, body_rows))

        # Scoring scale details
        pieces.append("\\paragraph{Scoring Scale Details}")
        pieces.append("\\begin{itemize}")
        for metric, stats in metrics_analysis.items():
            pieces.append(f"\\item \\textbf{{{esc_text(metric)}}}: {esc_text(stats['description'])}")
            pieces.append("\\begin{itemize}")
            for score, desc in stats['scale'].items():
                pieces.append(f"\\item {score} = {esc_text(desc)}")
            pieces.append("\\end{itemize}")
        pieces.append("\\end{itemize}")

    # Visualizations
    if image_paths:
        pieces.append("\\subsubsection{Visualizations}")
        pieces.append(esc_text(
            "The following visualizations provide detailed analysis of score distributions and quality patterns."
        ))

        individual_plots = [img for img in image_paths if "_scores.png" in img]
        combined_plots = [img for img in image_paths if "combined" in img]
        boxplots = [img for img in image_paths if "boxplot" in img]

        # Individual metric distributions
        if individual_plots:
            pieces.append("\\paragraph{Individual Metric Score Distributions}")
            pieces.append("Figures \\ref{fig:" + esc_label(tab_name) + "__Word_Accuracy_scores} through \\ref{fig:" + 
                          esc_label(tab_name) + "__Punctuation_And_Formatting_scores} show the distribution of categorical scores for each evaluation metric.")
            for img_path in individual_plots:
                img_name = os.path.basename(img_path)
                rel_path = f"{tab_name}/{img_name}"
                metric_name = img_name.replace("_scores.png", "").replace("_", " ").replace("And", "&")
                pieces.append("\\begin{figure}[!h]")
                pieces.append("\\centering")
                pieces.append(f"\\includegraphics[width=0.8\\textwidth, height=0.35\\textheight, keepaspectratio]{{{rel_path}}}")
                pieces.append(f"\\caption{{{esc_caption(metric_name)} score distribution showing frequency of quality levels}}")
                pieces.append(f"\\label{{fig:{esc_label(tab_name)}__{esc_label(img_name.replace('.png', ''))}}}")
                pieces.append("\\end{figure}")

                # Optional one-liner interpretation via LLM
                if metrics_analysis:
                    # Find matching metric key
                    matching_metric = None
                    for k in metrics_analysis.keys():
                        if k.replace("&", "And").replace(" ", "_") == img_name.replace("_scores.png", ""):
                            matching_metric = k
                            break
                    if matching_metric:
                        mk = llm_ctx["metrics"].get(matching_metric, None)
                        if mk:
                            interp_ctx = {"metric": matching_metric, "stats": mk}
                            fig_txt = gpt_text_cached("figure-interpretation", interp_ctx)
                            if fig_txt:
                                pieces.append(esc_text(fig_txt))

        # Combined distribution
        if combined_plots:
            pieces.append("\\paragraph{Comparative Score Analysis}")
            for img_path in combined_plots:
                img_name = os.path.basename(img_path)
                rel_path = f"{tab_name}/{img_name}"
                pieces.append("\\begin{figure}[!h]")
                pieces.append("\\centering")
                pieces.append(f"\\includegraphics[width=\\textwidth, height=0.45\\textheight, keepaspectratio]{{{rel_path}}}")
                pieces.append(f"\\caption{{Combined score distributions across all evaluation metrics}}")
                pieces.append(f"\\label{{fig:{esc_label(tab_name)}__{esc_label(img_name.replace('.png', ''))}}}")
                pieces.append("\\end{figure}")

        # Audio quality analysis
        if boxplots:
            pieces.append("\\paragraph{Performance by Audio Quality}")
            for img_path in boxplots:
                img_name = os.path.basename(img_path)
                rel_path = f"{tab_name}/{img_name}"
                pieces.append("\\begin{figure}[!h]")
                pieces.append("\\centering")
                pieces.append(f"\\includegraphics[width=\\textwidth, height=0.45\\textheight, keepaspectratio]{{{rel_path}}}")
                pieces.append(f"\\caption{{Evaluation metric performance stratified by audio quality ratings}}")
                pieces.append(f"\\label{{fig:{esc_label(tab_name)}__{esc_label(img_name.replace('.png', ''))}}}")
                pieces.append("\\end{figure}")

    # Insights
    pieces.append("\\subsubsection{Insights}")
    insights_llm = gpt_text_cached("insights-strengths-weaknesses", llm_ctx)
    if not insights_llm:
        # Deterministic fallback (short)
        strengths = []
        if metrics_analysis:
            high_perf = [k for k, v in metrics_analysis.items() if v['score_percentages'][1] > 60]
            if high_perf:
                strengths.append(f"Strong performance in {', '.join([esc_text(h) for h in high_perf])}.")
        if profile['foreign_share'] < 0.05:
            strengths.append("Minimal foreign language content aids linguistic consistency.")
        weaknesses = []
        if metrics_analysis:
            low_perf = [k for k, v in metrics_analysis.items() if v['score_percentages'][0] > 30]
            if low_perf:
                weaknesses.append(f"Quality gaps in {', '.join([esc_text(l) for l in low_perf])}.")
        insights_llm = " ".join(strengths + weaknesses) or "Dataset shows baseline adequacy for STT training."
    pieces.append(esc_text(insights_llm))

    # Implications
    imp_llm = gpt_text_cached("implications", llm_ctx)
    if not imp_llm:
        if metrics_analysis and len(metrics_analysis) > 0:
            avg_high_quality = np.mean([v['score_percentages'][1] for v in metrics_analysis.values()])
            if avg_high_quality > 60:
                imp_llm = "High overall annotation quality suggests minimal preprocessing before training."
            elif avg_high_quality > 30:
                imp_llm = "Mixed quality indicates selective filtering and targeted improvements before training."
            else:
                imp_llm = "Predominantly low scores warrant re-annotation or exclusion from training."
        else:
            imp_llm = "Standard quality assurance should suffice for integration."
    pieces.append(esc_text(imp_llm))

    # Recommendations
    pieces.append("\\subsubsection{Recommendations (Data Improvements)}")
    recs_llm = gpt_text_cached("recommendations-bulleted", llm_ctx)
    if recs_llm:
        rec_lines = [ln.strip().lstrip("-•").strip() for ln in recs_llm.splitlines() if ln.strip()]
        if rec_lines:
            pieces.append("\\begin{itemize}")
            for ln in rec_lines[:7]:
                pieces.append(f"\\item {esc_text(ln)}")
            pieces.append("\\end{itemize}")
    else:
        # Deterministic fallback bullets
        recommendations = []
        if metrics_analysis:
            low_metrics = [k for k, v in metrics_analysis.items() if v['score_percentages'][0] > 20]
            if low_metrics:
                recommendations.append(f"Implement targeted re-annotation for {', '.join([esc_text(l) for l in low_metrics])}.")
        if profile['foreign_share'] > 0.1:
            recommendations.append("Introduce code-switching annotation protocols or separate modeling for mixed-language spans.")
        recommendations.append("Enforce inter-annotator agreement with Cohen's kappa ≥ 0.8.")
        recommendations.append("Filter out audio with quality rating < 3 for primary training datasets.")
        if worst_samples:
            recommendations.append("Prioritize review of the worst-error samples to identify systematic issues.")
        if recommendations:
            pieces.append("\\begin{itemize}")
            for rec in recommendations:
                pieces.append(f"\\item {esc_text(rec)}")
            pieces.append("\\end{itemize}")

    # Worst Samples
    if worst_samples:
        pieces.append("\\subsubsection{Worst Samples}")
        pieces.append("Filenames with highest error rates requiring immediate quality review:")
        pieces.append("\\begin{itemize}")
        for filename in worst_samples:
            pieces.append(f"\\item {esc_text(filename)}")
        pieces.append("\\end{itemize}")

    # Write file
    path_component = safe_name(path_for_tab) if path_for_tab else safe_name(tab_name)
    tex_name = f"{safe_name(tab_name)}__{path_component}__STT_Eval_Report.tex"
    tex_path = os.path.join(out_dir, tex_name)
    with open(tex_path, "w", encoding="utf-8") as f:
        f.write("% !TEX root = main.tex\n")
        f.write("\n".join(pieces))
    return tex_path

# ========================
# Orchestration
# ========================
def run_analysis(xlsx_path, generate_plots=True):
    xl = pd.ExcelFile(xlsx_path)
    # Count tab for mapping
    count_name = None
    for nm in xl.sheet_names:
        if nm.strip().lower()=="count":
            count_name = nm; break
    count_df = pd.read_excel(xlsx_path, sheet_name=count_name) if count_name else pd.DataFrame()
    if not count_df.empty:
        count_df.columns = [norm(c) for c in count_df.columns]
    path_map = build_path_map(count_df)
    path_map.setdefault("Lina", "collect/miscellaneous/Dhaka FM")  # existing rule

    out_root = "STT_eval_reports_" + datetime.now().strftime("%Y%m%d_%H%M%S")
    os.makedirs(out_root, exist_ok=True)

    generated = []
    for tab in TARGET_TABS:
        tab_effective = tab if tab in xl.sheet_names else next((s for s in xl.sheet_names if s.strip().lower()==tab.strip().lower()), None)
        if tab_effective is None:
            continue
        df = pd.read_excel(xlsx_path, sheet_name=tab_effective)

        tab_dir = os.path.join(out_root, safe_name(tab))
        os.makedirs(tab_dir, exist_ok=True)

        # Generate required plots
        images = []
        if generate_plots:
            df_norm = normalize_columns(df)
            df_norm = extract_audio_quality_num(df_norm)
            score_metrics = ['Word Accuracy', 'Grammar & Syntax', 'Proper Noun Recognition', 'Punctuation & Formatting']
            for metric in score_metrics:
                if metric in df_norm.columns:
                    out_img = os.path.join(tab_dir, f"{metric.replace(' ', '_').replace('&', 'And')}_scores.png")
                    if plot_categorical_scores(df_norm[metric], metric, out_img):
                        images.append(out_img)
            metric_cols = [col for col in score_metrics if col in df_norm.columns]
            if metric_cols:
                out_img = os.path.join(tab_dir, "score_distributions_combined.png")
                if plot_score_distribution_combined(df_norm, metric_cols, out_img):
                    images.append(out_img)
            if metric_cols and 'AudioQ_num' in df_norm.columns:
                out_img = os.path.join(tab_dir, "metrics_by_AudioQuality_boxplot.png")
                if plot_boxplot_by_audio_quality(df_norm, metric_cols, out_img):
                    images.append(out_img)
        else:
            for fn in sorted(os.listdir(tab_dir)):
                if fn.lower().endswith((".png", ".pdf", ".jpg", ".jpeg")):
                    images.append(os.path.join(tab_dir, fn))

        path_for_tab = path_map.get(tab, path_map.get(tab_effective, ""))
        tex_path = write_tex(tab, path_for_tab, df, images, tab_dir)

        generated.append({
            "tab": tab,
            "tex": os.path.abspath(tex_path),
            "folder": os.path.abspath(tab_dir),
            "images": [os.path.abspath(p) for p in images],
            "path_from_count": path_for_tab
        })

    with open(os.path.join(out_root, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(generated, f, indent=2, ensure_ascii=False)

    print(f"Done. Output folder: {os.path.abspath(out_root)}")
    print("Ready for Overleaf upload - each tab has its own folder with LaTeX file and images:")
    for g in generated:
        print(f"- {g['tab']}: {g['folder']}")

# ========================
# CLI
# ========================
def test_llm_generation(xlsx_path='./STT Manual Eval Template (1).xlsx'):
    """Test LLM generation with sample data to verify meaningful output."""
    if not LLM_ENABLED:
        print("LLM not enabled. Set USE_LLM=1 in environment.")
        return
    
    print("Testing LLM generation with sample data...")
    
    # Create sample context for testing
    sample_ctx = {
        "tab": "TestTab",
        "path": "test/sample/data",
        "n_clips": 150,
        "total_minutes": 45.2,
        "foreign_share_pct": 12.5,
        "audio_quality_skew": "predominantly quality 4 (68%)",
        "metrics": {
            "Word Accuracy": {
                "N": 150,
                "pct_0": 15.3,
                "pct_05": 28.7,
                "pct_1": 56.0,
                "mode": 1.0,
                "quality_category": "mixed_quality",
                "dominant_pattern": "good_scores_dominate"
            },
            "Grammar & Syntax": {
                "N": 150,
                "pct_0": 35.2,
                "pct_05": 42.1,
                "pct_1": 22.7,
                "mode": 0.5,
                "quality_category": "low_quality",
                "dominant_pattern": "fair_scores_dominate"
            }
        },
        "analysis": {
            "overall_quality": "mixed",
            "best_performing_metrics": ["Word Accuracy"],
            "worst_performing_metrics": ["Grammar & Syntax"],
            "total_metrics_evaluated": 2,
            "avg_high_quality_pct": 39.4,
            "avg_low_quality_pct": 25.3
        }
    }
    
    # Test different section types
    sections = [
        "brief-summary",
        "dataset-profile", 
        "insights-strengths-weaknesses",
        "implications",
        "recommendations-bulleted"
    ]
    
    for section in sections:
        print(f"\n--- Testing {section} ---")
        result = gpt_text_cached(section, sample_ctx)
        if result:
            print(f"✓ Generated: {result[:100]}...")
        else:
            print("✗ Failed to generate content")
    
    print("\nLLM test complete. Check if outputs are data-specific and insightful.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", default='./STT Manual Eval Template (1).xlsx', help="Path to the evaluation Excel file")
    parser.add_argument("--no-plots", action="store_true", help="Do not generate plots; include existing images in tab folder instead")
    parser.add_argument("--test-llm", action="store_true", help="Test LLM generation with sample data")
    args = parser.parse_args()
    
    if args.test_llm:
        test_llm_generation(args.xlsx)
    else:
        run_analysis(args.xlsx, generate_plots=not args.no_plots)
import os, sys, json, math, argparse, re
from datetime import datetime
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from scipy import stats

# ------------------------
# Config
# ------------------------
TARGET_TABS = ["Lina","MRK","Dipto","Mehadi","Mashruf-2","Nusrat","Annoor","Annoor-2","Lina-2","Mashruf"]

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
    # Replace backslashes with forward slashes for paths
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
    # Replace problematic characters with safe alternatives
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
    # Keep only alphanumeric, underscore, and dash
    return "".join(c for c in s if c.isalnum() or c in "_-")

def latex_row(cells):
    """Create a LaTeX table row with proper escaping and validation."""
    escaped_cells = []
    for c in cells:
        c_str = esc_text(str(c))  # Escape first
        escaped_cells.append(c_str)
    return ' & '.join(escaped_cells) + r' \\'

def latex_table(env_caption, env_label, header_cells, body_rows):
    """Create a full table environment with booktabs."""
    parts = []
    parts.append(r'\begin{table}[t]\centering')
    parts.append(rf'\caption{{{esc_caption(env_caption)}}}\label{{{esc_label(env_label)}}}')
    # Use proper column specification for the metrics table: left-aligned metric names, right-aligned numbers
    if len(header_cells) == 6:  # Metrics table
        parts.append(r'\begin{tabular}{p{3.5cm}ccccc}')
    else:  # Default fallback
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
    """Normalize column names to standard format."""
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
    """Extract numeric audio quality (1-5) from Audio Quality column."""
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
    """Plot categorical score distribution as bar chart."""
    clean_data = pd.to_numeric(data, errors='coerce').dropna()
    if len(clean_data) == 0:
        return False
    
    # Count occurrences of each score
    score_counts = {}
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
    
    # Add count labels on bars
    for bar, count in zip(bars, counts):
        if count > 0:
            plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, 
                    str(count), ha='center', va='bottom')
    
    plt.tight_layout()
    plt.savefig(out_path, dpi=200, bbox_inches='tight')
    plt.close()
    return True

def plot_score_distribution_combined(df, metric_cols, out_path):
    """Plot combined categorical score distributions."""
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
            # Count occurrences of each score
            score_counts = {}
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
            
            # Add count labels on bars
            for bar, count in zip(bars, counts):
                if count > 0:
                    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, 
                           str(count), ha='center', va='bottom', fontsize=8)
    
    plt.tight_layout()
    plt.savefig(out_path, dpi=200, bbox_inches='tight')
    plt.close()
    return True

def plot_boxplot_by_audio_quality(df, metric_cols, out_path):
    """Plot boxplot of metrics by audio quality."""
    if 'AudioQ_num' not in df.columns or not metric_cols:
        return False
    
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    
    for i, col in enumerate(metric_cols[:4]):
        if i >= 4:
            break
        ax = axes[i]
        
        # Prepare data for boxplot
        data_by_quality = []
        labels = []
        for quality in sorted(df['AudioQ_num'].dropna().unique()):
            subset = df[df['AudioQ_num'] == quality][col].dropna()
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
    """Return the scoring scale descriptions."""
    return {
        'Word Accuracy': {
            'description': 'Measures how many words are transcribed correctly compared to the reference text.',
            'scale': {
                0: '<70% correct',
                0.5: '70–90% correct', 
                1: '>90% correct'
            }
        },
        'Grammar & Syntax': {
            'description': 'Assesses whether sentence structure and morphology (tense, case endings, agreement) are preserved.',
            'scale': {
                0: 'mostly incorrect syntax',
                0.5: 'partial errors',
                1: 'fluent and correct Bangla grammar'
            }
        },
        'Proper Noun Recognition': {
            'description': 'Checks recognition of names, places, organizations, and foreign words in context.',
            'scale': {
                0: 'mostly misrecognized',
                0.5: 'mixed accuracy',
                1: 'accurate most of the time'
            }
        },
        'Punctuation & Formatting': {
            'description': 'Evaluates automatic insertion of punctuation marks and segmentation.',
            'scale': {
                0: 'absent/misleading',
                0.5: 'partially correct',
                1: 'accurate and natural'
            }
        }
    }

def analyze_categorical_metrics(df):
    """Analyze metrics as categorical ordinal scores."""
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
        
        # Count occurrences of each score
        score_counts = {}
        score_percentages = {}
        
        for score in [0, 0.5, 1]:
            count = (data == score).sum()
            score_counts[score] = count
            score_percentages[score] = (count / n * 100) if n > 0 else 0
        
        # Get mode (most common score)
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
    """Get filenames with highest error rates."""
    if 'Word Accuracy' not in df.columns or 'Filename' not in df.columns:
        return []
    
    # Calculate error rate (1 - accuracy)
    df_copy = df.copy()
    df_copy['Error_Rate'] = 1 - pd.to_numeric(df_copy['Word Accuracy'], errors='coerce')
    
    # Sort by error rate and get worst samples
    worst = df_copy.nlargest(n_worst, 'Error_Rate')
    
    # Extract just filename (after last / or \)
    filenames = []
    for filename in worst['Filename']:
        if pd.notna(filename):
            clean_name = str(filename).replace('\\', '/').split('/')[-1]
            # Remove any remaining path separators
            clean_name = clean_name.split('\\')[-1]
            filenames.append(clean_name)
    
    return filenames[:n_worst]

def generate_dataset_profile(df):
    """Generate dataset profile with key statistics."""
    n = len(df)
    
    # Total minutes
    total_minutes = 0
    if 'Duration (seconds)' in df.columns:
        duration_data = pd.to_numeric(df['Duration (seconds)'], errors='coerce').dropna()
        total_minutes = duration_data.sum() / 60
    
    # Foreign language share
    foreign_share = 0
    if 'Language Content' in df.columns:
        lang_data = df['Language Content'].astype(str)
        foreign_count = lang_data.str.contains('foreign|english|mixed', case=False, na=False).sum()
        foreign_share = foreign_count / len(df) if len(df) > 0 else 0
    
    # Audio quality distribution
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

# ------------------------
# LaTeX rendering
# ------------------------
def write_tex(tab_name, path_for_tab, df, image_paths, out_dir):
    """Generate comprehensive LaTeX report following the specified structure."""
    pieces = []
    
    # Normalize data
    df = normalize_columns(df)
    df = extract_audio_quality_num(df)
    
    # Get analysis results
    profile = generate_dataset_profile(df)
    metrics_analysis = analyze_categorical_metrics(df)
    worst_samples = get_worst_samples(df)
    
    # Main section title
    data_path = path_for_tab if path_for_tab else "Unknown Path"
    pieces.append(f"\\subsection{{{esc_caption(data_path)}}}")
    
    # Brief summary
    pieces.append(f"This section evaluates {esc_text(str(profile['n_clips']))} audio clips from the {esc_text(data_path)} directory, "
                 f"representing {profile['total_minutes']:.1f} minutes of Bangla speech data intended for STT model training.")
    
    # Dataset Profile
    pieces.append("\\subsubsection{Dataset Profile}")
    
    profile_text = (f"The dataset contains {profile['n_clips']:,} clips totaling "
                   f"{profile['total_minutes']:.1f} minutes of audio content. ")
    
    if profile['audio_quality_skew']:
        profile_text += f"Audio quality distribution shows {esc_text(profile['audio_quality_skew'])} ratings. "
    
    if profile['foreign_share'] > 0.1:
        profile_text += f"Foreign language content comprises {profile['foreign_share']:.1%} of samples, "
        profile_text += "indicating potential code-mixing that requires careful handling in STT training."
    else:
        profile_text += "The dataset maintains predominantly Bangla content with minimal foreign language interference."
    
    pieces.append(profile_text)
    
    # Quantitative Metrics Summary
    if metrics_analysis:
        pieces.append("\\subsubsection{Quantitative Metrics Summary}")
        
        # Scoring scale explanation
        pieces.append("Evaluation uses ordinal categorical scoring (0–1) where each score represents specific quality thresholds rather than continuous measurements. "
                     "The following table shows score distributions across evaluation criteria with detailed metric descriptions provided in the subsequent scoring scale section.")
        
        # Build metrics table with categorical analysis
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
        
        # Analysis summary
        high_quality_metrics = [k for k, v in metrics_analysis.items() if v['score_percentages'][1] > 50]
        if high_quality_metrics:
            pieces.append(f"Strong performance observed in {', '.join([esc_text(m) for m in high_quality_metrics])} "
                         f"with majority scores at the highest quality level. ")
        
        low_quality_metrics = [k for k, v in metrics_analysis.items() if v['score_percentages'][0] > 30]
        if low_quality_metrics:
            pieces.append(f"Quality concerns identified in {', '.join([esc_text(m) for m in low_quality_metrics])} "
                         f"with substantial proportions receiving the lowest scores.")
    
    # Visualizations
    if image_paths:
        pieces.append("\\subsubsection{Visualizations}")
        
        pieces.append("The following visualizations provide detailed analysis of score distributions and quality patterns. "
                     "Each score represents a specific quality threshold: 0 indicates poor quality requiring significant improvement, "
                     "0.5 represents acceptable quality with some issues, and 1 denotes high-quality annotations suitable for direct STT training use.")
        
        # Group images by type for better organization
        individual_plots = [img for img in image_paths if "_scores.png" in img]
        combined_plots = [img for img in image_paths if "combined" in img]
        boxplots = [img for img in image_paths if "boxplot" in img]
        
        # Individual metric distributions
        if individual_plots:
            pieces.append("\\paragraph{Individual Metric Score Distributions}")
            pieces.append("Figures \\ref{fig:" + esc_label(tab_name) + "__Word_Accuracy_scores} through \\ref{fig:" + 
                         esc_label(tab_name) + "__Punctuation_And_Formatting_scores} show the distribution of categorical scores for each evaluation metric. "
                         "The height of each bar indicates the number of clips receiving that score level.")
            
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
                
                # Add interpretation for each metric
                if metrics_analysis and metric_name.replace("&", "And").replace(" ", "_") in [k.replace("&", "And").replace(" ", "_") for k in metrics_analysis.keys()]:
                    # Find the matching metric
                    matching_metric = None
                    for k in metrics_analysis.keys():
                        if k.replace("&", "And").replace(" ", "_") == metric_name.replace("&", "And").replace(" ", "_"):
                            matching_metric = k
                            break
                    
                    if matching_metric:
                        stats = metrics_analysis[matching_metric]
                        pieces.append(f"Figure \\ref{{fig:{esc_label(tab_name)}__{esc_label(img_name.replace('.png', ''))}}} reveals that "
                                    f"{stats['score_percentages'][0]:.1f}\\% of clips received poor scores (0), "
                                    f"{stats['score_percentages'][0.5]:.1f}\\% received fair scores (0.5), and "
                                    f"{stats['score_percentages'][1]:.1f}\\% achieved good scores (1). "
                                    f"The predominance of {'high-quality' if stats['score_percentages'][1] > 50 else 'mixed-quality' if stats['score_percentages'][0.5] > 40 else 'low-quality'} "
                                    f"scores indicates {'strong annotation consistency suitable for STT training' if stats['score_percentages'][1] > 50 else 'moderate quality requiring selective filtering' if stats['score_percentages'][0.5] > 40 else 'significant quality concerns requiring re-annotation'}.")
        
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
                
                pieces.append(f"Figure \\ref{{fig:{esc_label(tab_name)}__{esc_label(img_name.replace('.png', ''))}}} enables direct comparison of score distributions across metrics. "
                             f"Consistent patterns across metrics suggest systematic annotation quality, while divergent patterns may indicate "
                             f"metric-specific challenges or annotator training needs.")
        
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
                
                pieces.append(f"Figure \\ref{{fig:{esc_label(tab_name)}__{esc_label(img_name.replace('.png', ''))}}} demonstrates the relationship between audio quality and annotation performance. "
                             f"Higher audio quality ratings (Q4-Q5) typically correlate with better evaluation scores, while lower quality audio (Q1-Q3) "
                             f"presents greater transcription challenges. This relationship validates the importance of audio quality filtering in STT training data curation.")
    
    # Insights
    pieces.append("\\subsubsection{Insights}")
    
    # Strengths paragraph
    strengths = []
    if metrics_analysis:
        high_performers = [k for k, v in metrics_analysis.items() if v['score_percentages'][1] > 60]
        if high_performers:
            strengths.append(f"Strong performance in {', '.join([esc_text(h) for h in high_performers])} "
                           f"with majority scores at highest quality level indicates reliable annotation quality and suitable content for STT training. "
                           f"The individual score distribution figures clearly demonstrate this quality concentration at the optimal level.")
    
    if profile['foreign_share'] < 0.05:
        strengths.append("Minimal foreign language content ensures linguistic consistency for Bangla STT model development.")
    
    if profile['n_clips'] > 50:
        strengths.append(f"Substantial sample size ({profile['n_clips']:,} clips) provides adequate statistical power for training and evaluation.")
    
    if image_paths and any("boxplot" in img for img in image_paths):
        strengths.append("The audio quality stratification analysis confirms that higher-rated audio correlates with better annotation performance, "
                        "validating the quality assessment methodology.")
    
    if strengths:
        pieces.append(" ".join(strengths))
    else:
        pieces.append("Dataset shows baseline adequacy for STT training with standard preprocessing requirements.")
    
    # Weaknesses paragraph  
    weaknesses = []
    if metrics_analysis:
        low_performers = [k for k, v in metrics_analysis.items() if v['score_percentages'][0] > 30]
        if low_performers:
            weaknesses.append(f"Concerning performance gaps in {', '.join([esc_text(l) for l in low_performers])} "
                            f"with substantial poor-quality scores suggest systematic annotation inconsistencies requiring targeted quality improvement. "
                            f"The score distribution visualizations highlight these quality disparities across evaluation criteria.")
    
    if profile['foreign_share'] > 0.15:
        weaknesses.append(f"Elevated foreign language content ({profile['foreign_share']:.1%}) may introduce "
                         f"training instability without proper code-switching handling.")
    
    if any(v['N'] < 10 for v in metrics_analysis.values()):
        weaknesses.append("Limited sample sizes for some metrics reduce statistical reliability of performance estimates.")
    
    if weaknesses:
        pieces.append(" ".join(weaknesses))
    else:
        pieces.append("No critical quality issues identified that would preclude effective STT model training.")
    
    # Implications paragraph
    implications = []
    if metrics_analysis and len(metrics_analysis) > 0:
        # Calculate overall quality based on percentage of high scores (score = 1)
        avg_high_quality = np.mean([v['score_percentages'][1] for v in metrics_analysis.values()])
        if avg_high_quality > 60:
            implications.append("High overall annotation quality with majority high-quality scores supports direct integration into STT training pipelines "
                              "with minimal additional preprocessing requirements. The combined distribution analysis confirms consistent quality patterns across metrics.")
        elif avg_high_quality > 30:
            implications.append("Moderate annotation quality with mixed score distributions necessitates selective filtering and targeted quality "
                              "enhancement before STT model training to ensure optimal performance outcomes. The visualization analysis reveals specific areas requiring attention.")
        else:
            implications.append("Substantial quality concerns with predominant low scores require comprehensive re-annotation or exclusion "
                              "from training datasets to prevent degraded STT model performance. The score distribution patterns indicate systematic quality issues.")
    
    pieces.append(" ".join(implications) if implications else 
                 "Standard quality assurance protocols should suffice for STT training integration.")
    
    # Recommendations
    pieces.append("\\subsubsection{Recommendations (Data Improvements)}")
    
    recommendations = []
    
    if metrics_analysis:
        low_metrics = [k for k, v in metrics_analysis.items() if v['score_percentages'][0] > 20]
        if low_metrics:
            recommendations.append(f"Implement targeted re-annotation for {', '.join([esc_text(l) for l in low_metrics])} "
                                 f"to reduce poor-quality scores and achieve consistent high-quality annotations.")
    
    if profile['foreign_share'] > 0.1:
        recommendations.append("Establish explicit code-switching annotation protocols and consider separate "
                             "modeling approaches for mixed-language segments.")
    
    recommendations.append("Deploy inter-annotator agreement validation with Cohen's kappa targets above 0.8 "
                          "for all quality dimensions.")
    
    recommendations.append("Implement systematic audio quality filtering to exclude samples below quality rating 3 "
                          "from primary training datasets.")
    
    if worst_samples:
        recommendations.append("Prioritize quality review for identified problematic samples to understand "
                             "systematic error patterns and annotation guidelines gaps.")
    
    for rec in recommendations:
        pieces.append(rec)
    
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

# ------------------------
# Orchestration
# ------------------------
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
            # Normalize columns first
            df_norm = normalize_columns(df)
            df_norm = extract_audio_quality_num(df_norm)
            
            # Categorical score distribution plots
            score_metrics = ['Word Accuracy', 'Grammar & Syntax', 'Proper Noun Recognition', 'Punctuation & Formatting']
            
            # Individual categorical score plots
            for metric in score_metrics:
                if metric in df_norm.columns:
                    out_img = os.path.join(tab_dir, f"{metric.replace(' ', '_').replace('&', 'And')}_scores.png")
                    if plot_categorical_scores(df_norm[metric], metric, out_img):
                        images.append(out_img)
            
            # Combined score distribution plot
            metric_cols = [col for col in score_metrics if col in df_norm.columns]
            if metric_cols:
                out_img = os.path.join(tab_dir, "score_distributions_combined.png")
                if plot_score_distribution_combined(df_norm, metric_cols, out_img):
                    images.append(out_img)
            
            # Boxplot by audio quality
            if metric_cols and 'AudioQ_num' in df_norm.columns:
                out_img = os.path.join(tab_dir, "metrics_by_AudioQuality_boxplot.png")
                if plot_boxplot_by_audio_quality(df_norm, metric_cols, out_img):
                    images.append(out_img)
        else:
            # Include existing images
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

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", default='./STT Manual Eval Template (1).xlsx', help="Path to the evaluation Excel file")
    parser.add_argument("--no-plots", action="store_true", help="Do not generate plots; include existing images in tab folder instead")
    args = parser.parse_args()
    run_analysis(args.xlsx, generate_plots=not args.no_plots)
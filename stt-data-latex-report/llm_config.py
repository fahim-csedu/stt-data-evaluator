#!/usr/bin/env python3
"""
LLM Configuration for STT Report Generation
Adjust these settings to control LLM behavior and output quality.
"""

# Quality thresholds for analysis
QUALITY_THRESHOLDS = {
    "high_quality_threshold": 60.0,    # % of score=1 needed for "high quality"
    "low_quality_threshold": 30.0,     # % of score=0 that indicates "low quality"
    "foreign_content_threshold": 10.0,  # % foreign content that's concerning
    "min_sample_size": 10               # Minimum samples needed for reliable analysis
}

# LLM prompt templates for different quality scenarios
SCENARIO_PROMPTS = {
    "high_quality_dataset": {
        "insights": "Focus on the strengths that make this dataset suitable for STT training. Mention specific metrics with high performance.",
        "recommendations": "Suggest optimizations and advanced techniques since the base quality is strong."
    },
    "mixed_quality_dataset": {
        "insights": "Balance discussion of strengths and weaknesses. Identify which metrics need attention.",
        "recommendations": "Prioritize improvements for the weakest metrics while maintaining strengths."
    },
    "low_quality_dataset": {
        "insights": "Focus on the quality issues that need immediate attention. Be specific about problematic areas.",
        "recommendations": "Suggest fundamental improvements and quality control measures."
    }
}

# Section-specific guidance
SECTION_GUIDANCE = {
    "brief-summary": {
        "max_sentences": 2,
        "focus": "scope and purpose",
        "include_numbers": ["n_clips", "total_minutes"]
    },
    "dataset-profile": {
        "max_sentences": 4,
        "focus": "characteristics that impact training",
        "include_numbers": ["n_clips", "total_minutes", "foreign_share_pct", "audio_quality_skew"]
    },
    "insights-strengths-weaknesses": {
        "max_sentences": 6,
        "focus": "specific metric performance patterns",
        "include_numbers": ["percentages", "metric_names"]
    },
    "implications": {
        "max_sentences": 3,
        "focus": "training readiness and preprocessing needs",
        "include_numbers": ["overall_quality_indicators"]
    },
    "recommendations-bulleted": {
        "max_bullets": 5,
        "focus": "actionable improvements",
        "include_numbers": ["specific_metrics_needing_work"]
    }
}

def get_dataset_scenario(analysis_context):
    """Determine dataset quality scenario based on metrics."""
    if not analysis_context.get("analysis"):
        return "mixed_quality_dataset"
    
    overall_quality = analysis_context["analysis"]["overall_quality"]
    
    if overall_quality == "high":
        return "high_quality_dataset"
    elif overall_quality == "low":
        return "low_quality_dataset"
    else:
        return "mixed_quality_dataset"

def get_enhanced_prompt(section_type, context):
    """Get enhanced prompt based on dataset scenario and section type."""
    scenario = get_dataset_scenario(context)
    guidance = SECTION_GUIDANCE.get(section_type, {})
    scenario_prompt = SCENARIO_PROMPTS.get(scenario, {}).get(section_type.replace("-bulleted", ""), "")
    
    base_prompt = f"Write {guidance.get('max_sentences', 3)} sentences focusing on {guidance.get('focus', 'the data')}."
    
    if scenario_prompt:
        base_prompt += f" {scenario_prompt}"
    
    if section_type == "recommendations-bulleted":
        base_prompt = f"Provide {guidance.get('max_bullets', 5)} specific recommendations. {scenario_prompt}"
    
    return base_prompt
#!/usr/bin/env python3
"""
Validate that LLM is generating data-specific insights rather than generic text.
"""

import re
import json
from generate_stt_report_latex_llm import gpt_text_cached

def validate_data_specificity():
    """Test LLM with different data scenarios to ensure it generates specific insights."""
    
    print("🔍 Validating LLM Data Specificity")
    print("=" * 40)
    
    # Test scenario 1: High quality dataset
    high_quality_ctx = {
        "metrics": {
            "Word Accuracy": {"pct_0": 5.0, "pct_05": 15.0, "pct_1": 80.0, "quality_category": "high_quality"},
            "Grammar & Syntax": {"pct_0": 8.0, "pct_05": 12.0, "pct_1": 80.0, "quality_category": "high_quality"}
        },
        "analysis": {"overall_quality": "high", "best_performing_metrics": ["Word Accuracy", "Grammar & Syntax"]},
        "n_clips": 200, "total_minutes": 67.5
    }
    
    # Test scenario 2: Low quality dataset  
    low_quality_ctx = {
        "metrics": {
            "Word Accuracy": {"pct_0": 45.0, "pct_05": 35.0, "pct_1": 20.0, "quality_category": "low_quality"},
            "Grammar & Syntax": {"pct_0": 60.0, "pct_05": 25.0, "pct_1": 15.0, "quality_category": "low_quality"}
        },
        "analysis": {"overall_quality": "low", "worst_performing_metrics": ["Word Accuracy", "Grammar & Syntax"]},
        "n_clips": 150, "total_minutes": 42.3
    }
    
    scenarios = [
        ("High Quality Dataset", high_quality_ctx),
        ("Low Quality Dataset", low_quality_ctx)
    ]
    
    for scenario_name, ctx in scenarios:
        print(f"\n📊 Testing: {scenario_name}")
        print("-" * 30)
        
        # Test insights generation
        insights = gpt_text_cached("insights-strengths-weaknesses", ctx)
        
        if insights:
            # Check for data-specific elements
            has_percentages = bool(re.search(r'\d+\.?\d*%', insights))
            has_metric_names = any(metric in insights for metric in ctx["metrics"].keys())
            has_quality_terms = any(term in insights.lower() for term in ["high", "low", "strong", "weak", "concern"])
            
            print(f"✓ Generated insights ({len(insights)} chars)")
            print(f"  📈 Contains percentages: {has_percentages}")
            print(f"  🎯 Mentions specific metrics: {has_metric_names}")
            print(f"  💭 Uses quality language: {has_quality_terms}")
            
            if has_percentages and has_metric_names and has_quality_terms:
                print("  ✅ Appears data-specific and insightful")
            else:
                print("  ⚠️  May be too generic")
                
            print(f"  📝 Sample: {insights[:100]}...")
        else:
            print("  ❌ Failed to generate insights")
    
    # Test that different data produces different outputs
    print(f"\n🔄 Testing Output Variation")
    print("-" * 30)
    
    insights_1 = gpt_text_cached("insights-strengths-weaknesses", high_quality_ctx)
    insights_2 = gpt_text_cached("insights-strengths-weaknesses", low_quality_ctx)
    
    if insights_1 and insights_2:
        # Simple similarity check
        words_1 = set(insights_1.lower().split())
        words_2 = set(insights_2.lower().split())
        overlap = len(words_1.intersection(words_2))
        similarity = overlap / min(len(words_1), len(words_2)) if words_1 and words_2 else 1.0
        
        print(f"📊 Word overlap similarity: {similarity:.2f}")
        if similarity < 0.6:
            print("✅ Outputs are sufficiently different (good)")
        else:
            print("⚠️  Outputs may be too similar (check for generic responses)")
    
    print(f"\n✨ Validation complete!")

if __name__ == "__main__":
    validate_data_specificity()
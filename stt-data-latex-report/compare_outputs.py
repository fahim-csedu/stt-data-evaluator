#!/usr/bin/env python3
"""
Compare outputs between static and LLM versions to verify LLM generates 
data-specific insights rather than generic text.
"""

import os
import sys
import json
from pathlib import Path

def compare_reports(static_dir, llm_dir):
    """Compare LaTeX reports from static vs LLM versions."""
    
    print("🔍 Comparing Static vs LLM Report Generation")
    print("=" * 50)
    
    static_path = Path(static_dir)
    llm_path = Path(llm_dir)
    
    if not static_path.exists():
        print(f"❌ Static directory not found: {static_dir}")
        return
    
    if not llm_path.exists():
        print(f"❌ LLM directory not found: {llm_dir}")
        return
    
    # Find corresponding .tex files
    static_tex_files = list(static_path.glob("*/*.tex"))
    llm_tex_files = list(llm_path.glob("*/*.tex"))
    
    print(f"📄 Found {len(static_tex_files)} static reports")
    print(f"🤖 Found {len(llm_tex_files)} LLM reports")
    
    # Compare first matching pair
    if static_tex_files and llm_tex_files:
        static_file = static_tex_files[0]
        llm_file = llm_tex_files[0]
        
        print(f"\n📊 Comparing:")
        print(f"   Static: {static_file}")
        print(f"   LLM:    {llm_file}")
        
        with open(static_file, 'r', encoding='utf-8') as f:
            static_content = f.read()
        
        with open(llm_file, 'r', encoding='utf-8') as f:
            llm_content = f.read()
        
        # Extract key sections for comparison
        sections = [
            "Dataset Profile",
            "Insights", 
            "Recommendations"
        ]
        
        for section in sections:
            print(f"\n🔍 {section} Section:")
            print("-" * 30)
            
            # Find section in static
            static_section = extract_section(static_content, section)
            llm_section = extract_section(llm_content, section)
            
            if static_section and llm_section:
                print("📝 Static version:")
                print(static_section[:200] + "..." if len(static_section) > 200 else static_section)
                
                print("\n🤖 LLM version:")
                print(llm_section[:200] + "..." if len(llm_section) > 200 else llm_section)
                
                # Check for data-specific content
                if has_specific_numbers(llm_section) and not content_too_similar(static_section, llm_section):
                    print("✅ LLM version appears data-specific and different")
                else:
                    print("⚠️  LLM version may be too generic or similar to static")
            else:
                print("❌ Section not found in one or both files")

def extract_section(content, section_name):
    """Extract content of a specific section from LaTeX."""
    lines = content.split('\n')
    in_section = False
    section_lines = []
    
    for line in lines:
        if f"subsubsection{{{section_name}" in line:
            in_section = True
            continue
        elif in_section and line.strip().startswith("\\subsubsection"):
            break
        elif in_section:
            section_lines.append(line)
    
    return '\n'.join(section_lines).strip()

def has_specific_numbers(text):
    """Check if text contains specific percentages or numbers."""
    import re
    # Look for percentages, specific numbers, etc.
    patterns = [
        r'\d+\.\d+%',  # percentages like 56.7%
        r'\d+%',       # percentages like 75%
        r'\d+\.\d+',   # decimals like 45.2
    ]
    
    for pattern in patterns:
        if re.search(pattern, text):
            return True
    return False

def content_too_similar(text1, text2, threshold=0.7):
    """Check if two texts are too similar (basic word overlap)."""
    words1 = set(text1.lower().split())
    words2 = set(text2.lower().split())
    
    if not words1 or not words2:
        return False
    
    overlap = len(words1.intersection(words2))
    similarity = overlap / min(len(words1), len(words2))
    
    return similarity > threshold

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python compare_outputs.py <static_report_dir> <llm_report_dir>")
        print("Example: python compare_outputs.py STT_eval_reports_20251102_070208 STT_eval_reports_20251102_080000")
        sys.exit(1)
    
    compare_reports(sys.argv[1], sys.argv[2])
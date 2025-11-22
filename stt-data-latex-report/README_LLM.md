# STT Report Generator with LLM Enhancement

This enhanced version uses Large Language Models (LLM) to generate data-specific insights instead of static text templates.

## Setup

1. **Install dependencies:**
   ```bash
   pip install openai pandas numpy matplotlib scipy
   ```

2. **Configure environment:**
   ```bash
   # Copy and edit the .env file
   cp .env.example .env
   
   # Set your OpenAI API key and preferences
   export OPENAI_API_KEY=your_api_key_here
   export USE_LLM=1
   export LLM_MODEL=gpt-4o-mini  # or gpt-4o for better quality
   ```

3. **Source environment:**
   ```bash
   source .env
   ```

## Usage

### Generate Reports with LLM
```bash
python generate_stt_report_latex_llm.py --xlsx "your_data.xlsx"
```

### Test LLM Functionality
```bash
python generate_stt_report_latex_llm.py --test-llm
```

### Compare Static vs LLM Outputs
```bash
# Generate both versions
python generate_stt_report_latex.py --xlsx "data.xlsx"      # Static version
python generate_stt_report_latex_llm.py --xlsx "data.xlsx"  # LLM version

# Compare outputs
python compare_outputs.py STT_eval_reports_TIMESTAMP1 STT_eval_reports_TIMESTAMP2
```

## Key Improvements

### 1. Data-Specific Insights
- **Before:** "Strong performance observed in Word Accuracy with majority scores at the highest quality level."
- **After:** "Word Accuracy demonstrates strong performance with 56.0% of clips achieving perfect scores, while Grammar & Syntax shows concerning patterns with 35.2% receiving poor ratings, indicating systematic annotation inconsistencies."

### 2. Contextual Recommendations
- **Before:** Generic recommendations for all datasets
- **After:** Specific recommendations based on actual metric performance, sample size, and quality patterns

### 3. Intelligent Analysis
- Identifies best and worst performing metrics
- Calculates overall quality indicators
- Provides scenario-specific guidance (high/mixed/low quality datasets)

## Configuration

Edit `llm_config.py` to adjust:
- Quality thresholds for analysis
- Prompt templates for different scenarios
- Section-specific guidance and limits

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_LLM` | `0` | Enable/disable LLM (1=on, 0=off) |
| `LLM_MODEL` | `gpt-4o-mini` | OpenAI model to use |
| `LLM_MAX_TOKENS` | `350` | Maximum tokens per response |
| `LLM_TEMPERATURE` | `0.25` | Creativity level (0-1) |
| `LLM_CACHE_DIR` | `.llm_cache` | Cache directory for responses |

## Fallback Behavior

If LLM fails or is disabled:
- Automatically falls back to static text generation
- No functionality is lost
- Reports are still generated successfully

## Cost Considerations

- Uses caching to avoid redundant API calls
- Typical cost: $0.01-0.05 per report with gpt-4o-mini
- Use `gpt-4o-mini` for cost efficiency, `gpt-4o` for best quality

## Troubleshooting

### LLM Not Working
1. Check API key: `echo $OPENAI_API_KEY`
2. Verify environment: `echo $USE_LLM`
3. Test connection: `python generate_stt_report_latex_llm.py --test-llm`

### Generic Output
1. Check if LLM is actually enabled (look for "✓ LLM enabled" message)
2. Verify your data has sufficient variation in metrics
3. Review the generated context in `.llm_cache/` files

### API Errors
1. Check API key validity
2. Verify sufficient OpenAI credits
3. Try reducing `LLM_MAX_TOKENS` if hitting limits
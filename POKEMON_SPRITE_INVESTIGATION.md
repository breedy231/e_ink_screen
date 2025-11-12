# Pokemon Sprite E-ink Dashboard Investigation

## Executive Summary

Adding a random daily Pokemon sprite to the e-ink weather dashboard is highly feasible. This document outlines the technical approach for integrating Pokemon sprites with proper e-ink optimization and daily rotation.

## Current Dashboard Analysis

**Dashboard Specifications:**
- Resolution: 600x800px (portrait) / 800x600px (landscape)
- Format: Grayscale PNG (mode 'L')
- No alpha channel support
- High contrast required for e-ink readability
- Weather dashboard layout uses grid system (12 rows × 8 cols)

**Available Space for Pokemon Sprite:**
Looking at the current weather dashboard layout (`server/layouts/weather.json`):
- Rows 3-8: Weather component (6 rows)
- Rows 9-11: Device stats (left) and System stats (right) split
- **Opportunity**: Middle-right area currently has unused space, or we could add a dedicated sprite area

## Pokemon Sprite Sources

### PokeAPI GitHub Sprites Repository

**Official Artwork (Best Quality):**
```
https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{id}.png
```
- High resolution, colorful official artwork
- Pokemon IDs: 1-1025 (as of Gen 9)
- PNG format with transparent background

**Standard Sprites (Simpler):**
```
https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{id}.png
```
- Smaller, game-style sprites
- Simpler graphics, easier to process for e-ink

**Dream World (Vector):**
```
https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/dream-world/{id}.svg
```
- SVG format (would need conversion)

### Recommendation
Use **official artwork** for visual appeal, as the existing Python optimizer can handle the conversion to e-ink format.

## E-ink Optimization Requirements

The existing `server/optimize-for-eink.py` script handles:
1. ✅ Convert to grayscale (mode 'L')
2. ✅ Remove alpha channel
3. ✅ Apply high contrast (`ImageOps.autocontrast`)
4. ✅ Optimize PNG compression

**Additional Requirements for Pokemon Sprites:**
- Resize sprite to fit designated area (e.g., 150x150px or 200x200px)
- Ensure white background (replace transparent with white)
- Apply dithering for better e-ink rendering (optional)
- Cache sprites locally to avoid repeated downloads

## Daily Rotation Mechanism

### Approach 1: Date-Based Seed (Recommended)
```javascript
function getDailyPokemonId() {
    const today = new Date();
    const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
    const year = today.getFullYear();

    // Use date as seed for consistent daily Pokemon
    const seed = year * 1000 + dayOfYear;
    const pokemonId = (seed % 1025) + 1; // Pokemon IDs: 1-1025

    return pokemonId;
}
```

**Benefits:**
- Same Pokemon all day (consistent across updates)
- Deterministic (testable)
- Changes automatically at midnight
- No database/state needed

### Approach 2: Random with Daily Cache
Store the daily Pokemon ID in a cache file that expires at midnight.

### Approach 3: Themed Selection
Select Pokemon based on weather conditions:
- Rain → Water-type (Squirtle, Kyogre)
- Sun → Fire-type (Charmander, Blaziken)
- Snow → Ice-type (Articuno, Glaceon)
- Overcast → Flying-type (Pidgey, Rayquaza)

## Implementation Plan

### Phase 1: Pokemon Service Module
Create `server/pokemon-service.js`:

```javascript
const https = require('https');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');

class PokemonService {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache', 'pokemon');
        this.spriteSize = options.spriteSize || 150;

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Get Pokemon ID for today
     */
    getDailyPokemonId() {
        const today = new Date();
        const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
        const year = today.getFullYear();
        const seed = year * 1000 + dayOfYear;
        return (seed % 1025) + 1;
    }

    /**
     * Download Pokemon sprite from PokeAPI GitHub
     */
    async downloadSprite(pokemonId) {
        const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`;
        const rawPath = path.join(this.cacheDir, `pokemon_${pokemonId}_raw.png`);

        return new Promise((resolve, reject) => {
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download sprite: ${response.statusCode}`));
                    return;
                }

                const fileStream = fs.createWriteStream(rawPath);
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve(rawPath);
                });
            }).on('error', reject);
        });
    }

    /**
     * Optimize sprite for e-ink display
     */
    async optimizeSpriteForEink(rawPath, outputPath) {
        const execPromise = promisify(exec);

        // Use existing Python optimizer
        const pythonCmd = `python3 server/optimize-for-eink.py "${rawPath}" -o "${outputPath}"`;

        try {
            await execPromise(pythonCmd);
            return outputPath;
        } catch (error) {
            console.error('Error optimizing sprite:', error);
            throw error;
        }
    }

    /**
     * Get today's Pokemon sprite, optimized for e-ink
     */
    async getTodaysPokemonSprite() {
        const pokemonId = this.getDailyPokemonId();
        const cachedPath = path.join(this.cacheDir, `pokemon_${pokemonId}_eink.png`);

        // Check if we already have today's optimized sprite
        if (fs.existsSync(cachedPath)) {
            return {
                path: cachedPath,
                pokemonId,
                cached: true
            };
        }

        // Download and optimize
        const rawPath = await this.downloadSprite(pokemonId);
        await this.optimizeSpriteForEink(rawPath, cachedPath);

        return {
            path: cachedPath,
            pokemonId,
            cached: false
        };
    }

    /**
     * Get Pokemon name from ID (requires PokeAPI call or local data)
     */
    getPokemonName(pokemonId) {
        // Could implement API call or use local JSON data
        // For now, return ID
        return `Pokemon #${pokemonId}`;
    }
}

module.exports = PokemonService;
```

### Phase 2: Pokemon Dashboard Component
Add new component to `server/dashboard-engine.js`:

```javascript
class PokemonSpriteComponent extends ComponentBase {
    constructor(config = {}) {
        super('pokemon-sprite', {
            fontSize: 14,
            fontWeight: 'normal',
            textAlign: 'center',
            showName: config.showName !== false,
            showNumber: config.showNumber !== false,
            spritePath: config.spritePath || null,
            pokemonId: config.pokemonId || 0,
            pokemonName: config.pokemonName || 'Unknown',
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        // Load and draw Pokemon sprite
        if (this.config.spritePath && fs.existsSync(this.config.spritePath)) {
            try {
                const sprite = new Image();
                sprite.src = fs.readFileSync(this.config.spritePath);

                // Calculate centered position
                const spriteSize = Math.min(contentBounds.width, contentBounds.height - 30);
                const x = contentBounds.x + (contentBounds.width - spriteSize) / 2;
                const y = contentBounds.y;

                ctx.drawImage(sprite, x, y, spriteSize, spriteSize);

                // Draw Pokemon info below sprite
                if (this.config.showName || this.config.showNumber) {
                    this.setTextStyle(ctx);
                    const textY = y + spriteSize + 10;

                    if (this.config.showNumber) {
                        ctx.fillText(`#${this.config.pokemonId}`, contentBounds.x + contentBounds.width / 2, textY);
                    }

                    if (this.config.showName && this.config.pokemonName !== 'Unknown') {
                        ctx.fillText(this.config.pokemonName, contentBounds.x + contentBounds.width / 2, textY + 18);
                    }
                }
            } catch (error) {
                console.error('Error rendering Pokemon sprite:', error);
                // Fallback: show text only
                this.setTextStyle(ctx);
                ctx.fillText('Pokemon sprite unavailable', contentBounds.x + contentBounds.width / 2, contentBounds.y + contentBounds.height / 2);
            }
        } else {
            // No sprite available
            this.setTextStyle(ctx);
            ctx.fillText('Loading Pokemon...', contentBounds.x + contentBounds.width / 2, contentBounds.y + contentBounds.height / 2);
        }
    }
}
```

### Phase 3: Layout Integration
Create new layout `server/layouts/weather-pokemon.json`:

```json
{
  "name": "Weather Dashboard with Pokemon",
  "description": "Weather dashboard with daily Pokemon sprite",
  "grid": {
    "rows": 12,
    "cols": 8,
    "margin": 15,
    "gap": 8
  },
  "components": [
    {
      "type": "title",
      "position": { "row": 0, "col": 0, "colSpan": 8 },
      "config": {
        "text": "WEATHER DASHBOARD",
        "fontSize": 26,
        "fontWeight": "bold"
      }
    },
    {
      "type": "clock",
      "position": { "row": 1, "col": 0, "rowSpan": 2, "colSpan": 3 },
      "config": {
        "fontSize": 36,
        "format": "h:mm a"
      }
    },
    {
      "type": "date",
      "position": { "row": 1, "col": 3, "rowSpan": 2, "colSpan": 3 },
      "config": {
        "fontSize": 14,
        "dayFormat": "EEEE",
        "dateFormat": "MMM do, yyyy"
      }
    },
    {
      "type": "pokemon-sprite",
      "position": { "row": 1, "col": 6, "rowSpan": 3, "colSpan": 2 },
      "config": {
        "showName": false,
        "showNumber": true,
        "fontSize": 12
      }
    },
    {
      "type": "weather",
      "position": { "row": 3, "col": 0, "rowSpan": 6, "colSpan": 6 },
      "config": {
        "title": "CURRENT WEATHER",
        "fontSize": 16
      }
    },
    {
      "type": "device-stats",
      "position": { "row": 9, "col": 0, "rowSpan": 3, "colSpan": 4 },
      "config": {
        "title": "DEVICE",
        "fontSize": 13
      }
    },
    {
      "type": "stats",
      "position": { "row": 9, "col": 4, "rowSpan": 3, "colSpan": 4 },
      "config": {
        "title": "SYSTEM",
        "fontSize": 13
      }
    }
  ]
}
```

### Phase 4: Integration with Generator
Modify `server/generate-flexible-dashboard.js` to fetch Pokemon sprite:

```javascript
async generateDashboard(layoutName, options = {}) {
    // ... existing code ...

    // Fetch Pokemon sprite if layout uses it
    if (layoutConfig.components.some(c => c.type === 'pokemon-sprite')) {
        const pokemonService = new PokemonService();
        const sprite = await pokemonService.getTodaysPokemonSprite();

        // Inject sprite data into component config
        layoutConfig.components.forEach(component => {
            if (component.type === 'pokemon-sprite') {
                component.config.spritePath = sprite.path;
                component.config.pokemonId = sprite.pokemonId;
                component.config.pokemonName = pokemonService.getPokemonName(sprite.pokemonId);
            }
        });
    }

    // ... rest of generation code ...
}
```

## Testing Strategy

### Test Cases
1. **Basic Integration**: Verify Pokemon sprite appears on dashboard
2. **Daily Rotation**: Check that same Pokemon appears throughout the day
3. **Midnight Transition**: Verify Pokemon changes at midnight
4. **E-ink Optimization**: Ensure sprite is properly converted (grayscale, high contrast)
5. **Missing Sprite Handling**: Test fallback behavior for invalid Pokemon IDs
6. **Performance**: Measure generation time with sprite download vs. cached
7. **Visual Quality**: Test on actual Kindle e-ink display

### Testing Commands
```bash
# Test Pokemon service
node -e "const P = require('./server/pokemon-service.js'); new P().getTodaysPokemonSprite().then(console.log);"

# Generate Pokemon dashboard
node server/generate-flexible-dashboard.js weather-pokemon --test

# Deploy to Kindle for real e-ink testing
./generate-and-test.sh --deploy
```

## Performance Considerations

### Caching Strategy
- **First fetch**: ~2-5 seconds (download + optimization)
- **Cached**: <100ms (file read)
- Cache invalidation: Automatic daily rotation means old sprites accumulate
- **Solution**: Implement cache cleanup (keep last 30 days)

### Optimization Pipeline
```
Download (475KB) → Python PIL Processing (grayscale, contrast) → Canvas Rendering → Final PNG (25KB)
```

### Network Resilience
- Cache sprites for 7 days
- Fallback to "no sprite" display if download fails
- Consider bundling popular Pokemon sprites locally

## Alternative Approaches

### 1. Local Sprite Bundle
Pre-download 151 Gen 1 Pokemon sprites:
- **Pros**: No network dependency, instant rendering
- **Cons**: Larger repo size (~10MB for 151 sprites)
- **Use case**: Offline operation, faster generation

### 2. Weather-Based Selection
Select Pokemon based on current weather:
```javascript
function getWeatherPokemon(weatherCondition) {
    const weatherPokemon = {
        'rain': [7, 8, 9, 54, 55, 186], // Squirtle line, Psyduck, etc.
        'clear': [4, 5, 6, 37, 38, 136], // Charmander, Vulpix, Flareon
        'snow': [124, 144, 145, 225, 471], // Ice types
        'cloudy': [16, 17, 18, 21, 22, 83], // Flying types
        'fog': [92, 93, 94, 353, 354] // Ghost types
    };

    const options = weatherPokemon[weatherCondition] || [25]; // Default: Pikachu
    return options[Math.floor(Math.random() * options.length)];
}
```

### 3. Animated Sprite Rotation
Show different frame/pose every 5 minutes during the day:
- Multiple sprites per Pokemon
- Simulates "animation" via updates
- More dynamic feel

## Implementation Timeline

**Phase 1: Core Service** (2-3 hours)
- Create PokemonService class
- Implement download and caching
- Add daily rotation logic

**Phase 2: Dashboard Component** (1-2 hours)
- Create PokemonSpriteComponent
- Integrate with dashboard-engine.js
- Handle sprite rendering

**Phase 3: E-ink Optimization** (1-2 hours)
- Modify optimize-for-eink.py for sprite resizing
- Test contrast and readability
- Optimize file size

**Phase 4: Layout & Testing** (2-3 hours)
- Create weather-pokemon layout
- Test on actual Kindle hardware
- Fine-tune positioning and sizing

**Total**: ~8-10 hours development + testing

## Recommended Next Steps

1. ✅ Create `pokemon-service.js` with daily rotation logic
2. ✅ Test sprite download and caching
3. ✅ Extend Python optimizer for sprite-specific processing
4. ✅ Add PokemonSpriteComponent to dashboard-engine.js
5. ✅ Create weather-pokemon layout
6. ✅ Test on actual Kindle device
7. ✅ Document new feature in CLAUDE.md
8. ✅ Deploy to production (Raspberry Pi / Netlify)

## Security & Rate Limiting

**PokeAPI GitHub CDN:**
- Public CDN, no authentication required
- No strict rate limits for raw.githubusercontent.com
- Caching reduces requests to once per day
- Respectful usage: <2000 unique sprites exist

**Best Practices:**
- Implement exponential backoff on download failures
- Cache sprites for at least 24 hours
- Consider local fallback bundle for critical sprites

## Conclusion

Adding a daily Pokemon sprite to the e-ink dashboard is **highly feasible** with the existing infrastructure. The key components are:

1. **Simple API**: Direct PNG URLs from GitHub, no authentication
2. **Existing Optimizer**: Python script handles e-ink conversion
3. **Modular Architecture**: Component system makes integration straightforward
4. **Smart Caching**: Minimal network overhead after first fetch

**Estimated visual result**: A clean, high-contrast Pokemon silhouette in the corner of the dashboard that changes daily, adding personality without compromising readability.

The feature enhances the dashboard with minimal complexity and creates a "Pokemon of the Day" experience that makes checking the weather more engaging!

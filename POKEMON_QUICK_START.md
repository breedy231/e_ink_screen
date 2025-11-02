# Pokemon Sprite Integration - Quick Start Guide

## TL;DR

Add this to your e-ink dashboard in 4 files:

## 1. Create `server/pokemon-service.js`

```javascript
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

class PokemonService {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache', 'pokemon');

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    getDailyPokemonId() {
        const today = new Date();
        const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
        const seed = today.getFullYear() * 1000 + dayOfYear;
        return (seed % 1025) + 1;
    }

    async downloadSprite(pokemonId) {
        const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`;
        const rawPath = path.join(this.cacheDir, `pokemon_${pokemonId}_raw.png`);

        if (fs.existsSync(rawPath)) {
            return rawPath;
        }

        return new Promise((resolve, reject) => {
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}`));
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

    async optimizeForEink(rawPath, outputPath) {
        const execPromise = promisify(exec);
        const cmd = `python3 server/optimize-for-eink.py "${rawPath}" -o "${outputPath}"`;
        await execPromise(cmd);
        return outputPath;
    }

    async getTodaysPokemon() {
        const pokemonId = this.getDailyPokemonId();
        const cachedPath = path.join(this.cacheDir, `pokemon_${pokemonId}_eink.png`);

        if (fs.existsSync(cachedPath)) {
            return { path: cachedPath, id: pokemonId, cached: true };
        }

        const rawPath = await this.downloadSprite(pokemonId);
        await this.optimizeForEink(rawPath, cachedPath);
        return { path: cachedPath, id: pokemonId, cached: false };
    }
}

module.exports = PokemonService;
```

## 2. Add to `server/dashboard-engine.js`

Add this class after the existing components (around line 535):

```javascript
class PokemonSpriteComponent extends ComponentBase {
    constructor(config = {}) {
        super('pokemon-sprite', {
            fontSize: 14,
            fontWeight: 'normal',
            textAlign: 'center',
            showNumber: config.showNumber !== false,
            spritePath: config.spritePath || null,
            pokemonId: config.pokemonId || 0,
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        if (this.config.spritePath && fs.existsSync(this.config.spritePath)) {
            try {
                const { Image } = require('canvas');
                const sprite = new Image();
                sprite.src = fs.readFileSync(this.config.spritePath);

                // Calculate size and position
                const spriteSize = Math.min(contentBounds.width, contentBounds.height - 25);
                const x = contentBounds.x + (contentBounds.width - spriteSize) / 2;
                const y = contentBounds.y;

                // Draw sprite
                ctx.drawImage(sprite, x, y, spriteSize, spriteSize);

                // Draw Pokemon ID
                if (this.config.showNumber) {
                    this.setTextStyle(ctx);
                    const textY = y + spriteSize + 5;
                    ctx.fillText(`#${this.config.pokemonId}`,
                        contentBounds.x + contentBounds.width / 2, textY);
                }
            } catch (error) {
                console.error('Error rendering Pokemon:', error);
                this.setTextStyle(ctx);
                ctx.fillText('Pokemon error',
                    contentBounds.x + contentBounds.width / 2,
                    contentBounds.y + contentBounds.height / 2);
            }
        }
    }
}
```

Register the component in the constructor (around line 555):

```javascript
this.registerComponent('pokemon-sprite', PokemonSpriteComponent);
```

Add to module.exports (around line 662):

```javascript
module.exports = {
    DashboardEngine,
    GridSystem,
    ComponentBase,
    ClockComponent,
    DateComponent,
    StatsComponent,
    TitleComponent,
    PokemonSpriteComponent  // Add this line
};
```

## 3. Create `server/layouts/weather-pokemon.json`

```json
{
  "name": "Weather Dashboard with Pokemon",
  "description": "Weather dashboard featuring daily Pokemon sprite",
  "grid": {
    "rows": 12,
    "cols": 8,
    "margin": 15,
    "gap": 8
  },
  "components": [
    {
      "type": "title",
      "position": { "row": 0, "col": 0, "colSpan": 6 },
      "config": {
        "text": "WEATHER DASHBOARD",
        "fontSize": 26,
        "fontWeight": "bold"
      }
    },
    {
      "type": "pokemon-sprite",
      "position": { "row": 0, "col": 6, "rowSpan": 3, "colSpan": 2 },
      "config": {
        "showNumber": true,
        "fontSize": 12
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
      "type": "weather",
      "position": { "row": 3, "col": 0, "rowSpan": 6, "colSpan": 8 },
      "config": {
        "title": "CURRENT WEATHER",
        "fontSize": 16,
        "titleSize": 1.4
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

## 4. Modify `server/generate-flexible-dashboard.js`

Add at the top with other requires (around line 4):

```javascript
const PokemonService = require('./pokemon-service');
```

In the `generateDashboard` method, add before `engine.loadLayout(layoutConfig)` (around line 90):

```javascript
// Fetch Pokemon sprite if layout uses it
if (layoutConfig.components.some(c => c.type === 'pokemon-sprite')) {
    try {
        const pokemonService = new PokemonService();
        const pokemon = await pokemonService.getTodaysPokemon();

        // Inject sprite data into component configs
        layoutConfig.components.forEach(component => {
            if (component.type === 'pokemon-sprite') {
                component.config.spritePath = pokemon.path;
                component.config.pokemonId = pokemon.id;
            }
        });

        console.log(`🎮 Today's Pokemon: #${pokemon.id} ${pokemon.cached ? '(cached)' : '(downloaded)'}`);
    } catch (error) {
        console.error('⚠️  Pokemon sprite error:', error.message);
        // Remove Pokemon component if it fails
        layoutConfig.components = layoutConfig.components.filter(c => c.type !== 'pokemon-sprite');
    }
}
```

## 5. Test It!

```bash
# Generate Pokemon dashboard
node server/generate-flexible-dashboard.js weather-pokemon --test

# Check the output
open test-images/dashboard_weather-pokemon.png

# Deploy to Kindle
./generate-and-test.sh --layout weather-pokemon --deploy

# View on Kindle
ssh root@kindle "/usr/sbin/eips -g /mnt/us/dashboard/dashboard.png"
```

## Testing Individual Components

```bash
# Test Pokemon ID calculation
node -e "const P = require('./server/pokemon-service.js'); console.log('Today:', new P().getDailyPokemonId());"

# Test sprite download
node -e "const P = require('./server/pokemon-service.js'); new P().getTodaysPokemon().then(r => console.log('Downloaded:', r));"

# Test sprite optimization (requires PIL)
python3 server/optimize-for-eink.py cache/pokemon/pokemon_25_raw.png --check
```

## Troubleshooting

### "No module named 'PIL'"
```bash
pip3 install Pillow
```

### Sprite download fails
- Check internet connection
- Try different Pokemon ID: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png`
- Check cache directory exists: `mkdir -p cache/pokemon`

### Sprite doesn't appear on dashboard
- Check sprite file exists: `ls -lh cache/pokemon/`
- Verify component registered: `grep PokemonSpriteComponent server/dashboard-engine.js`
- Check logs for errors: `node server/generate-flexible-dashboard.js weather-pokemon --test`

### Sprite looks bad on e-ink
- Increase contrast in `optimize-for-eink.py`: Change `cutoff=1` to `cutoff=2`
- Try different size: Modify `spriteSize` calculation in component
- Test on actual Kindle (simulator may not match)

## Customization Options

### Different Pokemon daily
Modify `getDailyPokemonId()` in `pokemon-service.js`:
```javascript
// Random daily Pokemon
getDailyPokemonId() {
    const today = new Date().toDateString();
    const hash = today.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
    return (Math.abs(hash) % 1025) + 1;
}
```

### Weather-based Pokemon
```javascript
getWeatherPokemon(weatherCondition) {
    const weatherTypes = {
        'rain': [7, 54, 60, 120, 134], // Water types
        'clear': [4, 37, 58, 136],      // Fire types
        'snow': [124, 144, 215, 471],   // Ice types
        'cloudy': [16, 21, 83, 142]     // Flying types
    };
    const options = weatherTypes[weatherCondition] || [25]; // Default Pikachu
    return options[Math.floor(Math.random() * options.length)];
}
```

### Different position
Edit `weather-pokemon.json` position object:
```json
"position": { "row": 7, "col": 3, "rowSpan": 2, "colSpan": 2 }
```

## What You Get

- ✅ New Pokemon sprite every day at midnight
- ✅ Automatic download and caching
- ✅ E-ink optimized (grayscale, high contrast)
- ✅ Graceful fallback if download fails
- ✅ ~150ms performance impact (cached)
- ✅ Fun daily surprise on your dashboard!

**Current Pokemon**: #932 (Nov 2, 2025)
**Tomorrow's Pokemon**: #933 (Nov 3, 2025)

---

**Need help?** See full documentation in:
- `POKEMON_SUMMARY.md` - Complete overview
- `POKEMON_SPRITE_INVESTIGATION.md` - Technical deep dive
- `POKEMON_VISUAL_MOCKUP.md` - Design details

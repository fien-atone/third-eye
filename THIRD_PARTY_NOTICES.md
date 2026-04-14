# Third-Party Notices

This project includes adapted source code from the open-source projects listed
below. All copyright notices and license texts are preserved as required by
their respective licenses.

---

## CodeBurn

- **Repository**: https://github.com/AgentSeal/codeburn
- **License**: MIT
- **Used in**: `webapp/server/lib/` (parser, classifier, model pricing, provider
  adapters). Files were vendored and may be modified independently of upstream.

### License text

```
MIT License

Copyright (c) 2026 AgentSeal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Pricing data — LiteLLM

- **Repository**: https://github.com/BerriAI/litellm
- **License**: MIT
- **Used in**: At runtime, `webapp/server/lib/models.ts` fetches
  `model_prices_and_context_window.json` from LiteLLM's public repo and caches
  it for 24h under `~/.cache/codeburn/` (path inherited from upstream).
  Pricing data is consumed for cost calculation; no LiteLLM source code is
  bundled.

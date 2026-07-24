# wiremd

## Description
Enable pi agent to interact with wiremd for creating and managing UI wireframes using Markdown syntax. Provides semantic awareness of wiremd-specific patterns and commands.

## Capabilities
- Generate wireframes from markdown syntax
- Validate wiremd syntax
- Convert between visual styles (sketch, clean, wireframe, etc.)
- Export to multiple formats (HTML, React, Tailwind)
- Analyze wireframe structure and dependencies

## Usage

### Basic Commands
```bash
# Generate wireframe with visual style
wiremd generate <file> --style <style>

# Validate wiremd syntax
wiremd validate <file>

# List available visual styles
wiremd styles

# Export to different formats
wiremd export <file> --format <format>
```

### pi-Specific Integration
```typescript
// Access wiremd AST in pi
const { parse, renderToHTML } = require('wiremd');
const ast = parse(`
## Contact Form

Name
[_____________________________]
`);
const html = renderToHTML(ast, { style: 'sketch' });
```

## Entity Types
- `wireframe` - Top-level wireframe document
- `container` - Layout containers (grids, sections)
- `component` - UI elements (buttons, inputs, etc.)
- `style` - Visual theme attributes

## Common Patterns
- `## Section {.grid-3}` - Responsive grid layout
- `[________________]` - Input field
- `[Submit]{.primary}` - Styled button
- `![Image](path.png)` - Embedded image

## Best Practices
1. Use semantic headings for component organization
2. Validate wireframes before export (`wiremd validate`)
3. Use consistent style naming
4. Keep wireframes modular for reuse

## Example Workflow
1. Create wireframe: `wiremd new contact.md`
2. Edit with pi's syntax highlighting
3. Validate: `wiremd validate contact.md`
4. Generate: `wiremd generate contact.md --style sketch`
5. Export: `wiremd export contact.md --format react`
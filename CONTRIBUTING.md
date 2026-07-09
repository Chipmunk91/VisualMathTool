# Contributing to Matrix Meets Vector 🤝

Thank you for your interest in contributing to Matrix Meets Vector! This project aims to make linear algebra more accessible and intuitive through interactive 3D visualizations.

## 🎯 How You Can Contribute

### 🐛 Bug Reports
- Use clear, descriptive titles
- Include steps to reproduce the issue
- Mention browser version and operating system
- Add screenshots or videos if helpful

### ✨ Feature Suggestions
- Describe the educational value of the feature
- Explain how it would improve student understanding
- Consider implementation complexity
- Reference mathematical concepts it would support

### 🔧 Code Contributions
- Follow the existing code style and patterns
- Write clear commit messages
- Add tests for new functionality
- Update documentation as needed

## 🚀 Getting Started

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/your-username/matrix-meets-vector.git
   cd matrix-meets-vector
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

### Project Structure

```
src/
├── App.tsx              # Router + shared tool shell
├── pages/               # Top-level pages (Home, NotFound)
├── components/ui/       # Shared UI primitives
├── lib/                 # Shared utilities
└── tools/
    ├── registry.ts      # Tool registry — one entry per tool
    └── linear-algebra/  # Matrix Meets Vector
        ├── index.tsx    # Tool entry component
        ├── components/  # 3D scene, inputs, analysis panels
        └── lib/         # Math, parsing, colors, Zustand stores
```

The easiest way to contribute a new tool: add a folder under `src/tools/` and register it in `src/tools/registry.ts` (see the README for a walkthrough).

## 📏 Code Standards

### TypeScript
- Use strict TypeScript configuration
- Define proper interfaces and types
- Avoid `any` types when possible
- Document complex mathematical functions

### React Components
- Use functional components with hooks
- Follow React best practices
- Keep components focused and reusable
- Use proper prop validation

### Mathematical Code
- Add comprehensive comments for algorithms
- Test edge cases thoroughly
- Ensure numerical stability
- Document mathematical concepts

### Styling
- Use Tailwind CSS for styling
- Follow responsive design principles
- Maintain consistent spacing and colors
- Ensure accessibility standards

## 🧮 Mathematical Contributions

### Adding New Mathematical Features
1. **Research the concept**: Understand the educational value
2. **Plan the visualization**: How will students see and interact with it?
3. **Implement calculations**: Add to `lib/math.ts` with proper testing
4. **Create UI components**: Build intuitive interfaces
5. **Add documentation**: Explain the mathematical concepts

### Mathematical Accuracy
- Verify algorithms against established mathematical sources
- Test with edge cases and boundary conditions
- Handle numerical precision issues appropriately
- Document mathematical assumptions and limitations

## 🎨 UI/UX Guidelines

### Design Principles
- **Clarity**: Make mathematical concepts visually clear
- **Interactivity**: Enable hands-on exploration
- **Feedback**: Provide immediate visual feedback
- **Accessibility**: Support diverse learning needs

### User Experience
- Minimize cognitive load
- Provide helpful tooltips and explanations
- Enable progressive disclosure of complexity
- Support both novice and advanced users

## 🧪 Testing

### Manual Testing
- Test across different browsers (Chrome, Firefox, Safari)
- Verify mathematical accuracy with known examples
- Check responsive design on various screen sizes
- Test performance with complex scenarios

### Automated Testing
- Write unit tests for mathematical functions
- Test React components with proper mocking
- Verify numerical stability and edge cases
- Add integration tests for user workflows

## 📝 Commit Guidelines

### Commit Message Format
```
type(scope): brief description

Detailed explanation if needed

- Additional points
- Mathematical concepts affected
```

### Types
- `feat`: New feature or mathematical capability
- `fix`: Bug fix or mathematical correction
- `docs`: Documentation updates
- `style`: Code formatting (no logic changes)
- `refactor`: Code restructuring
- `test`: Adding or updating tests
- `perf`: Performance improvements

### Examples
```bash
git commit -m "feat(math): add eigenvalue computation for 3x3 matrices"
git commit -m "fix(vectors): correct angle calculation between vectors"
git commit -m "docs(readme): add section on matrix transformations"
```

## 🔍 Pull Request Process

### Before Submitting
1. **Test thoroughly**: Ensure your changes work correctly
2. **Check code style**: Follow project conventions
3. **Update documentation**: Add relevant docs
4. **Verify mathematical accuracy**: Double-check calculations

### Pull Request Template
```markdown
## Description
Brief description of changes

## Mathematical Concepts
- Which concepts does this affect?
- How does it improve student understanding?

## Testing
- [ ] Manual testing completed
- [ ] Mathematical accuracy verified
- [ ] Cross-browser compatibility checked
- [ ] Responsive design tested

## Screenshots/Videos
Include visual examples of changes
```

### Review Process
1. **Automated checks**: Ensure code builds and tests pass
2. **Mathematical review**: Verify accuracy and educational value
3. **Code review**: Check style, performance, and maintainability
4. **Testing**: Verify functionality across environments

## 🎓 Educational Focus

### Target Audience
- **Students**: Learning linear algebra concepts
- **Educators**: Teaching with visual tools
- **Researchers**: Exploring mathematical relationships

### Educational Principles
- **Visual Learning**: Make abstract concepts tangible
- **Interactive Exploration**: Enable hands-on discovery
- **Progressive Complexity**: Support learning journeys
- **Multiple Representations**: Show concepts in various ways

## 🤔 Questions?

### Getting Help
- Open an issue for questions
- Join community discussions
- Review existing documentation
- Check mathematical references

### Community Guidelines
- Be respectful and inclusive
- Focus on educational value
- Share knowledge generously
- Support fellow contributors

---

Thank you for helping make linear algebra more accessible and engaging for learners everywhere! 🚀📚
# AIH PulseCheck

AIH PulseCheck is a healthcare-focused conversational agent prototype developed to support nurses through faster access to information, workflow assistance, and safer decision support during routine tasks. The project was built using Dialogflow CX with backend webhook logic to create a more context-aware and practical chatbot experience for healthcare use cases.

## Project Overview

This project explores how conversational AI can be applied beyond simple FAQ interactions by supporting structured healthcare conversations and task-oriented assistance. Instead of relying purely on generative AI, the chatbot was designed with guided flows, backend logic, and iterative testing to improve reliability and usability in a more realistic nursing context.

The system was developed as part of an academic project and focuses on building a prototype that demonstrates both technical implementation and practical relevance. It also reflects the importance of research, testing, and iteration when creating AI systems for sensitive domains such as healthcare.

## Key Features

- Structured conversational flows built with Dialogflow CX
- Backend webhook logic in Node.js for custom handling and dynamic responses
- Session-based personalization for more context-aware interactions
- Medication-related support features such as dosage, interaction, and contraindication checks
- Visual risk indication using clear response cues
- Prototype workflow support designed around healthcare-related use cases
- External testing with nursing student users for early usability feedback

## Tech Stack

- Dialogflow CX
- Google Cloud
- Vertex AI handlers / webhook integration
- Node.js
- JavaScript
- Git
- GitHub

## Repository Structure

```text
AIH_PulseCheck/
├─ backend/
│  └─ index.js
│  └─ package.json
├─ dialogflow-agent/
└─ README.md
```

## Demo Video

Watch the project showcase here:

[![Watch the demo](https://img.youtube.com/vi/KEGamUsYXvg/0.jpg)](https://www.youtube.com/watch?v=KEGamUsYXvg)

Direct link: https://www.youtube.com/watch?v=KEGamUsYXvg

## How It Works

The chatbot uses Dialogflow CX to manage the main conversation flows and user interaction paths. To extend its capabilities beyond standard intent matching, backend logic was implemented using Node.js, allowing the system to process session data, support contextual responses, and handle more specific healthcare-related logic.

This approach made it possible to create a more realistic prototype rather than a simple scripted chatbot. Features such as medication checking and session-aware responses helped demonstrate how conversational agents can support task-based workflows in healthcare settings.

## My Role

This project involved taking on a technical approach that was not directly covered in class, which made the development process challenging at the start. Early on, very little was working, and the implementation required repeated experimentation, troubleshooting, and persistence before a working prototype was achieved.

Once the first functional prototype was completed, development became much smoother because it provided a foundation for building more advanced features. The project also involved sharing technical progress with the team, refining the workflow, and contributing to testing and iteration based on user feedback.

## Testing and Validation

Although it was difficult to engage working nurses due to their limited availability, the prototype was tested with nursing student users who were still able to provide meaningful feedback. Their input helped identify usability issues, surface minor bugs, and validate whether the chatbot interactions were understandable and relevant to healthcare-related scenarios.

One key lesson from the testing process was that external testing should begin as early as possible, even when the prototype is still incomplete. Fresh users are often able to spot issues much faster than the development team.

## Challenges

A major challenge in this project was that the technical approach was relatively uncharted compared to what had been taught in class. This meant that the team had to spend significant time experimenting and troubleshooting before even a simple prototype worked.

Another challenge was balancing technical ambition with testing opportunities. With more time, the project could have gone through more rounds of external testing and refinement, which would likely have improved stability and polish further.

## Key Learnings

This project reinforced that generative AI alone is not enough for solving complex real-world problems, especially in structured or high-stakes domains. Effective AI systems require domain research, thoughtful design, prototyping, testing, and multiple rounds of iteration.

It also showed the value of persistence in development. Reaching the first working prototype was the hardest part, but once a stable base existed, the rest of the development process became much easier and more focused.

## Notes

This repository is a portfolio version of the original academic project. Sensitive information, credentials, and restricted materials have been removed or redacted before publication.

## Future Improvements

- Expand testing with actual working nurses
- Improve the breadth and depth of medication-related support
- Refine chatbot responses based on more user feedback
- Strengthen UI and interaction design for better usability
- Add clearer deployment and setup instructions for reproducibility

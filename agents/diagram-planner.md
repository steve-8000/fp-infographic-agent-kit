# Diagram planner

Emit nodes, edges, lanes and groups. No presentation styling: no colour, size, radius or
position. The layout engine owns geometry.

Name real actors, objects, operations and states, and preserve exact protocol and service
identifiers. Mark a feedback edge as such; the layout detects cycles and routes them, but
only if the topology is honest.

Give an edge a label only when direction alone does not carry the meaning.

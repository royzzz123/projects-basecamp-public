curl -X POST "https://apis.airawat.cdac.in/msebisec/nemotron3-120bbf16/v1/chat/completions" \
  -H "Authorization: Bearer <REDACTED_JWT>" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "nemotron-3-120b-a12b-bf16",
    "messages": [
      {
        "role": "system",
        "content": "You are Xyne'\''s agentic assistant. Use tools when you need to plan, search, or synthesize a final answer."
      },
      {
        "role": "user",
        "content": "What is the capital of France?"
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "toDoWrite",
          "description": "Create or update an execution plan with sequential tasks.",
          "parameters": {
            "type": "object",
            "properties": {
              "goal": { "type": "string" },
              "subTasks": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "id": { "type": "string" },
                    "description": { "type": "string" },
                    "status": { "type": "string" },
                    "toolsRequired": {
                      "type": "array",
                      "items": { "type": "string" }
                    }
                  },
                  "required": ["id", "description", "toolsRequired"]
                }
              }
            },
            "required": ["goal", "subTasks"]
          }
        }
      }
    ]
  }'

 

 

 

Please find below the details required to access the models via the respective endpoints. Kindly ensure that the token is used without the double quotes.
An example request has been attached to this email for your reference.

Token: "<REDACTED_JWT>"

Model: lightonai/LightOnOCR-2-1B-bbox

Endpoint URL: https://apis.airawat.cdac.in/msebisec-lightonocr-bbox/v1/chat/completions

Sample Curl Request:
curl -k -X POST "https://apis.airawat.cdac.in/msebisec-lightonocr-bbox/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <REDACTED_JWT>" \
  --data '{
    "model": "lightonai/LightOnOCR-2-1B-bbox",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Describe this image in one sentence."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://cdn.britannica.com/61/93061-050-99147DCE/Statue-of-Liberty-Island-New-York-Bay.jpg"
            }
          }
        ]
      }
    ]
  }'





nemotron-3-nano:30b-a3b-q4_K_M
Endpoint URL: https://apis.airawat.cdac.in/msebisec-nemotron/api/generate

Sample Curl Request:
curl -X POST "https://apis.airawat.cdac.in/msebisec-nemotron/api/generate" \
  -H "accept: application/json" \
  -H "Authorization: Bearer <REDACTED_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nemotron-3-nano:30b-a3b-q4_K_M",
    "prompt": "Explain Kubernetes",
    "stream": false,
    "options": {
      "num_predict": 512
    }
  }'





curl -k  -X POST "https://apis.airawat.cdac.in/msebisec/gemma4-26b/v1/chat/completions" -H "Content-Type: application/json" -H 'Authorization: Bearer <REDACTED_JWT>' --data '{"model":"gemma-4-26b-aa4b-it","messages":[{"role":"user","content":[{"type":"text","text":"Describe this image in one sentence."},{"type":"image_url","image_url":{"url":"https://cdn.britannica.com/61/93061-050-99147DCE/Statue-of-Liberty-Island-New-York-Bay.jpg"}}]}]}'
"""LangGraph ReAct agent for SEBI complaint queries."""
from typing import Annotated

import httpx
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing_extensions import TypedDict

from agent.prompts import SYSTEM_PROMPT
from agent.tools import make_tools
from config import settings


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def build_graph(db: AsyncIOMotorDatabase) -> StateGraph:
    tools = make_tools(db)

    # Build httpx client — proxy and SSL are no-ops for local dev but required
    # on SEBI VMs (no direct internet, CDAC certs not in trust store).
    http_client = httpx.AsyncClient(
        proxy=settings.llm_http_proxy or None,
        verify=settings.llm_verify_ssl,
    )

    llm = ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_llama_70b_bearer_token,
        model=settings.llm_llama_70b_model_id,
        temperature=0,
        streaming=True,
        http_async_client=http_client,
    ).bind_tools(tools)

    tool_node = ToolNode(tools)

    async def agent_node(state: AgentState) -> dict:
        messages = state["messages"]
        # Prepend system prompt if not already present
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)
        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    def should_continue(state: AgentState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    return graph.compile()
